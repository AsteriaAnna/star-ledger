import type {Entity} from '../domain/index.ts';
import type {BusinessCommand,ResolveSettlement} from '../domain/accounting.ts';
import type {Command,LedgerSnapshot} from './index.ts';
import {financialIssues} from '../domain/invariants.ts';

export function settlementConflictIds(snapshot:LedgerSnapshot,id:string):string[] {
 const owned=new Set(snapshot.entities.filter(e=>e.fields.transaction_id===id||e.fields.from_transaction_id===id).map(e=>JSON.stringify([e.type,e.id])));
 return [...new Set(snapshot.conflicts.filter(c=>(c.entity_type==='transactions'&&c.entity_id===id)||owned.has(JSON.stringify([c.entity_type,c.entity_id]))).flatMap(c=>c.candidates.map(v=>v.operation_id)))].sort();
}
export function resolveSettlement(c:ResolveSettlement,snapshot:LedgerSnapshot,interpret:(command:BusinessCommand,s:LedgerSnapshot)=>Command[]):Command[] {
 const original=snapshot.entities.find(e=>e.type==='transactions'&&e.id===c.transactionId);
 if(!original||original.fields.deleted_at)throw Error('TRANSACTION_UNAVAILABLE');
 const rootConflicts=snapshot.conflicts.filter(x=>x.entity_type==='transactions'&&x.entity_id===c.transactionId);
 if(!rootConflicts.some(x=>['status','posting_plan'].includes(x.field))||rootConflicts.some(x=>!['status','posting_plan'].includes(x.field)))throw Error('NO_RESOLVABLE_SETTLEMENT');
 const expected=settlementConflictIds(snapshot,c.transactionId);
 if(!Array.isArray(c.expectedOperationIds)||JSON.stringify([...c.expectedOperationIds].sort())!==JSON.stringify(expected))throw Error('STALE_CONFLICT');
 if(!['SUCCESS','FAILED'].includes(c.status))throw Error('INVALID_STATUS');
 const owned=(e:Entity)=>e.fields.transaction_id===c.transactionId||e.fields.from_transaction_id===c.transactionId;
 const ownedKeys=new Set(snapshot.entities.filter(owned).map(e=>JSON.stringify([e.type,e.id])));
 const clean:LedgerSnapshot={entities:snapshot.entities.filter(e=>!(e.type==='transactions'&&e.id===c.transactionId)&&!owned(e)),conflicts:snapshot.conflicts.filter(x=>!(x.entity_type==='transactions'&&x.entity_id===c.transactionId)&&!ownedKeys.has(JSON.stringify([x.entity_type,x.entity_id])))};
 let desired:Command[]=[];
 if(c.status==='SUCCESS') {
  const event=c.settlement;
  if(!event||event.id!==original.id||event.kind!==original.fields.event_type||event.amount!==original.fields.display_amount||event.occurredAt!==original.fields.occurred_at)throw Error('SETTLEMENT_MISMATCH');
  desired=interpret({...event,status:'SUCCESS'},clean).filter(x=>x.entity.type!=='transactions');
 }
 const postings=desired.filter(x=>x.entity.type!=='source_records');
 const result:Command[]=[{action:'RESOLVE_CONFLICT',entity:{type:'transactions',id:original.id,fields:{status:c.status,posting_plan:JSON.stringify(postings.map(x=>x.entity))}}}];
 for(const cmd of desired) {
  const old=snapshot.entities.find(e=>e.type===cmd.entity.type&&e.id===cmd.entity.id);
  if(!old)result.push(cmd);
  else if(cmd.entity.type==='source_records') {
   if(Object.keys(cmd.entity.fields).some(k=>old.fields[k]!==cmd.entity.fields[k]))throw Error('IMMUTABLE_SOURCE');
  }else result.push({action:'RESOLVE_CONFLICT',entity:cmd.entity});
 }
 // Keep the audit trail, but zero out postings belonging only to the rejected interpretation.
 for(const e of snapshot.entities.filter(owned))if(!desired.some(x=>x.entity.type===e.type&&x.entity.id===e.id)) {
  if(e.type==='balance_movements')result.push({action:'RESOLVE_CONFLICT',entity:{...e,fields:{account_id:null,amount:0}}});
  if(e.type==='transaction_links'&&c.status==='FAILED')result.push({action:'RESOLVE_CONFLICT',entity:e});
  if(e.type==='consumption_effects')result.push({action:'RESOLVE_CONFLICT',entity:{...e,fields:{amount:0,category_id:null,subcategory_id:null}}});
 }
 const projected=snapshot.entities.map(e=>({...e,fields:{...e.fields}}));
 for(const cmd of result){const old=projected.find(e=>e.type===cmd.entity.type&&e.id===cmd.entity.id);if(old)Object.assign(old.fields,cmd.entity.fields);else projected.push(cmd.entity);}
 if(financialIssues(projected).some(issue=>issue.involved.includes(c.transactionId)))throw Error('RESOLUTION_BREAKS_ACCOUNTING');
 return result;
}
