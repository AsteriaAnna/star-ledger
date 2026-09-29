import {financialIssues} from '../domain/invariants.ts';
import type {Operation,Entity,Conflict,Json} from '../domain/index.ts';
export function project(ops:Operation[]) {
 const byId=new Map(ops.map(o=>[o.id,o]));
 const ancestors=new Map<string,Set<string>>();
 function ancestry(id:string,visiting=new Set<string>()):Set<string> {
  if(ancestors.has(id))return ancestors.get(id)!;
  if(visiting.has(id))throw Error('CAUSAL_CYCLE');
  const op=byId.get(id);if(!op)throw Error('MISSING_DEPENDENCY');
  visiting.add(id);const a=new Set<string>();
  for(const p of op.parents){a.add(p);for(const x of ancestry(p,visiting))a.add(x);}
  visiting.delete(id);ancestors.set(id,a);return a;
 }
 for(const op of ops)ancestry(op.id);
 const before=(a:Operation,b:Operation)=>ancestors.get(b.id)!.has(a.id);
 const maximal=(list:Operation[])=>list.filter(a=>!list.some(b=>before(a,b))).sort((a,b)=>a.id.localeCompare(b.id));
 const grouped=new Map<string,Operation[]>();
 for(const o of ops){const key=JSON.stringify([o.entity.type,o.entity.id]);grouped.set(key,[...(grouped.get(key)||[]),o]);}
 const entities:Entity[]=[],conflicts:Conflict[]=[],versions:{type:string;id:string;field:string;ids:string[]}[]=[];
 for(const [key,list] of grouped) {
  const creates=list.filter(o=>o.action==='CREATE_ENTITY');
  if(!creates.length)throw Error('EDIT_BEFORE_CREATE');
  if(creates.length>1) {
   const type=creates[0].entity.type;
   const derived=['balance_movements','consumption_effects','transaction_links'].includes(type);
   const sameSource=type==='source_records'&&creates.every(o=>JSON.stringify(o.entity.fields)===JSON.stringify(creates[0].entity.fields));
   const concurrent=creates.every(a=>creates.every(b=>a===b||(!before(a,b)&&!before(b,a))));
   const parent=creates[0].entity.fields.transaction_id??creates[0].entity.fields.from_transaction_id;
   if(!(derived||sameSource)||!concurrent||!parent||creates.some(o=>(o.entity.fields.transaction_id??o.entity.fields.from_transaction_id)!==parent))throw Error('CREATE_ID_COLLISION');
  }
  for(const o of list)if(o.action!=='CREATE_ENTITY'&&!creates.some(c=>before(c,o)))throw Error('EDIT_BEFORE_CREATE');
  const e:Entity={type:list[0].entity.type,id:list[0].entity.id,fields:list[0].entity.type==='transactions'?{posting_plan:null}:{}};
  const addConflict=(field:string,candidates:{operation_id:string;value:Json}[])=>conflicts.push({id:JSON.stringify([key,field]),entity_type:e.type,entity_id:e.id,field,candidates});
  for(const field of new Set(list.flatMap(o=>Object.keys(o.entity.fields)))) {
   const heads=maximal(list.filter(o=>Object.hasOwn(o.entity.fields,field)));
   versions.push({type:e.type,id:e.id,field,ids:heads.map(o=>o.id)});
   e.fields[field]=heads[0].entity.fields[field];
   if(new Set(heads.map(o=>JSON.stringify(o.entity.fields[field]))).size>1)addConflict(field,heads.map(o=>({operation_id:o.id,value:o.entity.fields[field]})));
  }
  const deletes=list.filter(o=>o.action==='DELETE_ENTITY');
  const childIds=new Set(ops.filter(o=>o.action==='CREATE_ENTITY'&&o.entity.fields.transaction_id===e.id).map(o=>JSON.stringify([o.entity.type,o.entity.id])));
  const aggregateList=e.type==='transactions'?ops.filter(o=>list.includes(o)||childIds.has(JSON.stringify([o.entity.type,o.entity.id]))):list;
  const edits=aggregateList.filter(o=>o.action==='PATCH_FIELD'||(o.action==='RESOLVE_CONFLICT'&&!Object.hasOwn(o.entity.fields,'deleted_at')));
  const unresolved=new Map<string,Operation>();
  for(const d of deletes)for(const edit of edits)if(!before(d,edit)&&!before(edit,d)) {
   const resolved=list.some(r=>r.action==='RESOLVE_CONFLICT'&&Object.hasOwn(r.entity.fields,'deleted_at')&&before(d,r)&&before(edit,r));
   if(!resolved){unresolved.set(d.id,d);unresolved.set(edit.id,edit);}
  }
  if(unresolved.size){e.fields.deleted_at=null;addConflict('$lifecycle',[...unresolved.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(o=>({operation_id:o.id,value:{action:o.action,entity_type:o.entity.type,entity_id:o.entity.id,fields:o.entity.fields}})));}
  entities.push(e);
 }
 for(const issue of financialIssues(entities)) {
  const relevant=ops.filter(o=>(o.entity.type==='transactions'&&issue.involved.includes(o.entity.id))||issue.involved.includes(o.entity.fields.transaction_id as string));
  const heads=maximal(relevant);
  conflicts.push({id:JSON.stringify(['accounting',issue.transactionId,issue.code]),entity_type:'transactions',entity_id:issue.transactionId,field:'$accounting',candidates:heads.map(o=>({operation_id:o.id,value:{code:issue.code,transaction_ids:issue.involved}}))});
 }
 return {entities,conflicts,versions};
}
