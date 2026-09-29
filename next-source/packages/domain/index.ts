export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type EntityType = 'transactions'|'accounts'|'source_records'|'balance_movements'|'consumption_effects'|'transaction_links'|'import_rules';
export type Entity = {type:EntityType; id:string; fields:Record<string,Json>};
export type Operation = {id:string; device:string; seq:number; command_id:string; command_index:number; command_size:number; parents:string[]; action:'CREATE_ENTITY'|'PATCH_FIELD'|'DELETE_ENTITY'|'RESOLVE_CONFLICT'; entity:Entity;};
export type Batch = {version:1; device:string; seq:number; operations:Operation[]; checksum:string};
export interface Store {
 atomic<T>(work:()=>T):T;
 allOperations():Operation[];
 append(op:Operation,local:boolean):void;
 project(entities:Entity[],conflicts:Conflict[],versions:FieldVersion[]):void;
 get(type:EntityType,id:string):Entity|undefined;
}
export type FieldVersion = {type:string;id:string;field:string;ids:string[]};
export type Conflict = {id:string; entity_type:EntityType; entity_id:string; field:string; candidates:{operation_id:string;value:Json}[]};
// All money is integer CNY fen. Liability positive movement increases debt.
export const fields:Record<EntityType,Record<string,'string'|'money'|'nullable'>> = {
 import_rules:{rule_key:'string',value:'nullable'},
 transactions:{posting_plan:'nullable',event_type:'string',status:'string',occurred_at:'string',display_amount:'money',display_name:'string',note:'string',created_at:'string',deleted_at:'nullable'},
 accounts:{name:'string',type:'string',balance_tracking:'string',balance_state:'string',opening_balance:'money',opening_balance_at:'string',last4:'string',deleted_at:'nullable'},
 source_records:{transaction_id:'string',source_type:'string',platform:'string',raw_payload:'string',created_at:'string'},
 balance_movements:{transaction_id:'string',account_id:'nullable',amount:'money',created_at:'string'},
 consumption_effects:{transaction_id:'string',amount:'money',category_id:'nullable',subcategory_id:'nullable',effective_at:'string',created_at:'string'},
 transaction_links:{from_transaction_id:'string',to_transaction_id:'string',type:'string'}
};
export function validate(op:Operation):void {
 if(!op || !/^[\w-]+$/.test(op.device) || !Number.isSafeInteger(op.seq) || op.seq<1 || op.id!==`${op.device}:${op.seq}`) throw Error('INVALID_OPERATION');
 if(!Number.isSafeInteger(op.command_size)||op.command_size<1||!Number.isSafeInteger(op.command_index)||op.command_index<0||op.command_index>=op.command_size||op.command_id!==`${op.device}:${op.seq-op.command_index}`) throw Error('INVALID_COMMAND_GROUP');
 if(!Array.isArray(op.parents)||op.parents.some(p=>typeof p!=='string')||new Set(op.parents).size!==op.parents.length) throw Error('INVALID_PARENTS');
 if(!['CREATE_ENTITY','PATCH_FIELD','DELETE_ENTITY','RESOLVE_CONFLICT'].includes(op.action)) throw Error('INVALID_ACTION');
 const e=op.entity; const spec=fields[e?.type];
 if(!spec||typeof e.id!=='string'||!e.id||!e.fields||Array.isArray(e.fields)) throw Error('INVALID_ENTITY');
 for(const [k,v] of Object.entries(e.fields)) {
  if(!Object.hasOwn(spec,k)) throw Error('INVALID_FIELD');
  if(spec[k]==='money' ? !Number.isSafeInteger(v) : spec[k]==='string' ? typeof v!=='string' : !(v===null||typeof v==='string')) throw Error('INVALID_VALUE');
 }
 if(op.action==='CREATE_ENTITY' && Object.keys(spec).some(k=>!(e.type==='transactions'&&k==='posting_plan')&&!Object.hasOwn(e.fields,k))) throw Error('MISSING_FIELD');
 if(op.action==='DELETE_ENTITY' && (Object.keys(e.fields).length!==1||typeof e.fields.deleted_at!=='string')) throw Error('INVALID_DELETE');
 if(op.action==='PATCH_FIELD' && (Object.keys(e.fields).length!==1||Object.hasOwn(e.fields,'deleted_at'))) throw Error('INVALID_PATCH');
 if(op.action==='RESOLVE_CONFLICT' && !Object.keys(e.fields).length) throw Error('EMPTY_RESOLUTION');
 if(e.type==='source_records'&&op.action!=='CREATE_ENTITY') throw Error('IMMUTABLE_SOURCE');
}
