import type {Store,Entity,Operation,Conflict} from '../domain/index.ts';
import {validate} from '../domain/index.ts';
import {project} from '../sync/projection.ts';
export type Command={action:Operation['action'];entity:Entity};
export type LedgerSnapshot = {entities:Entity[];conflicts:Conflict[]};
export class AccountingService {
 private store:Store; private device:string;
 constructor(store:Store,device:string){this.store=store;this.device=device;}
 execute(input:Command[]|((snapshot:LedgerSnapshot)=>Command[]),fault?:()=>void):Operation[] {
  return this.store.atomic(()=>{
   const ops=this.store.allOperations();const result:Operation[]=[];
   const commands=typeof input==='function'?input(project(ops)):input;
   if(!commands.length){if(typeof input==='function')return [];throw Error('EMPTY_COMMAND');}
   let seq=Math.max(0,...ops.filter(o=>o.device===this.device).map(o=>o.seq));
   const commandId=`${this.device}:${seq+1}`;
   for(const c of commands) {
    const existing=this.store.get(c.entity.type,c.entity.id);
    if(c.action==='PATCH_FIELD') {
     const blocked=project(ops).conflicts.some(x=>(x.entity_type===c.entity.type&&x.entity_id===c.entity.id&&(x.field==='$lifecycle'||Object.hasOwn(c.entity.fields,x.field))) || (x.field==='$lifecycle'&&x.entity_type==='transactions'&&existing?.fields.transaction_id===x.entity_id));
     if(blocked)throw Error('EXPLICIT_RESOLUTION_REQUIRED');
     if(Object.hasOwn(c.entity.fields,'account_id')&&!(c.entity.type==='balance_movements'&&existing?.fields.account_id===null&&commands.some(other=>other.entity.type===c.entity.type&&other.entity.id===c.entity.id&&Object.hasOwn(other.entity.fields,'amount'))))throw Error('STRUCTURAL_EDIT_NOT_SUPPORTED');
     if(Object.keys(c.entity.fields).some(k=>['transaction_id','from_transaction_id','to_transaction_id','created_at'].includes(k)))throw Error('STRUCTURAL_EDIT_NOT_SUPPORTED');
    }
    if(existing?.fields.transaction_id) {
     const parent=this.store.get('transactions',existing.fields.transaction_id as string);
     if(parent?.fields.deleted_at)throw Error('PARENT_DELETED');
    }
    if(c.action!=='CREATE_ENTITY'&&!existing&&!result.some(o=>o.entity.id===c.entity.id&&o.entity.type===c.entity.type))throw Error('MISSING_ENTITY');
    if(c.action==='PATCH_FIELD'&&existing?.fields.deleted_at)throw Error('ENTITY_DELETED');
    if(c.action==='RESOLVE_CONFLICT'&&Object.hasOwn(c.entity.fields,'deleted_at')&&c.entity.fields.deleted_at!==null&&typeof c.entity.fields.deleted_at!=='string')throw Error('INVALID_RESOLUTION');
    seq++;
    // Observed causal frontier; clocks and timestamps never select a winning edit.
    const known=new Set(ops.flatMap(o=>o.parents));
    const parents=ops.filter(o=>!known.has(o.id)).map(o=>o.id).sort();
    const op:Operation={id:`${this.device}:${seq}`,device:this.device,seq,command_id:commandId,command_index:result.length,command_size:commands.length,parents,action:c.action,entity:structuredClone(c.entity)};
    validate(op);ops.push(op);result.push(op);
   }
   const p=project(ops);this.store.project(p.entities,p.conflicts,p.versions);
   fault?.(); // Test hook: fail between business projection and outbox insertion.
   for(const op of result)this.store.append(op,true);
   return result;
  });
 }
}
