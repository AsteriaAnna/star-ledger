import {resolveSettlement} from './resolution.ts';
import type {Store,Entity,Operation} from '../domain/index.ts';
import type {BusinessCommand,AccountRef,EventBase} from '../domain/accounting.ts';
import {AccountingService} from './index.ts';
import type {Command,LedgerSnapshot} from './index.ts';

const create=(entity:Entity):Command=>({action:'CREATE_ENTITY',entity});
function money(value:number,allowZero=false):void {
 if(!Number.isSafeInteger(value)||(allowZero?value<0:value<=0))throw Error('INVALID_MONEY');
}
function timestamp(value:string):void {
 // Require explicit UTC to avoid device-local interpretation differences.
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error('INVALID_TIMESTAMP');
 const canonical=new Date(value).toISOString();
 if(canonical!==value&&canonical.replace('.000Z','Z')!==value)throw Error('INVALID_TIMESTAMP');
}
function identifier(value:string):void {if(typeof value!=='string'||!value.trim()||value.length>200)throw Error('INVALID_ID');}
function sum(values:number[]):number {return values.reduce((a,b)=>{const n=a+b;if(!Number.isSafeInteger(n))throw Error('MONEY_OVERFLOW');return n;},0);}

export class BusinessAccountingService {
 private core:AccountingService;
 constructor(store:Store,device:string){this.core=new AccountingService(store,device);}
 execute(command:BusinessCommand):Operation[] {return this.core.execute(snapshot=>interpret(command,snapshot));}
}

/** Pure interpretation. The caller runs it inside the same SQLite transaction as commit. */
export function interpret(c:BusinessCommand,snapshot:LedgerSnapshot):Command[] {
 if(c.kind==='RESOLVE_SETTLEMENT')return resolveSettlement(c,snapshot,interpret);
 const entities=snapshot.entities;
 const get=(type:Entity['type'],id:string)=>entities.find(e=>e.type===type&&e.id===id);
 const assertClear=(type:Entity['type'],id:string)=>{
  if(snapshot.conflicts.some(x=>(x.entity_type===type&&x.entity_id===id)||(type==='transactions'&&get(x.entity_type,x.entity_id)?.fields.transaction_id===id)))throw Error('UNRESOLVED_CONFLICT');
 };
 const account=(id:AccountRef)=>{
  if(id===null)return undefined;identifier(id);
  const a=get('accounts',id);if(!a||a.fields.deleted_at)throw Error('ACCOUNT_UNAVAILABLE');
  assertClear('accounts',id);return a;
 };
 const commands:Command[]=[];
 if(c.kind==='SET_STATUS') {
  const original=get('transactions',c.transactionId);
  if(!original||original.fields.deleted_at)throw Error('TRANSACTION_UNAVAILABLE');
  assertClear('transactions',c.transactionId);
  if(!['SUCCESS','FAILED'].includes(c.status))throw Error('INVALID_STATUS');
  if(original.fields.status===c.status) {
   if(c.status==='SUCCESS'&&c.settlement) {
    const v=c.settlement;
    if(v.id!==original.id||v.kind!==original.fields.event_type||v.amount!==original.fields.display_amount||v.occurredAt!==original.fields.occurred_at)throw Error('SETTLEMENT_MISMATCH');
    const withoutCurrent={...snapshot,entities:entities.filter(e=>!(e.type==='transactions'&&e.id===original.id)&&e.fields.transaction_id!==original.id&&e.fields.from_transaction_id!==original.id)};
    const expected=JSON.stringify(interpret({...v,status:'SUCCESS'},withoutCurrent).filter(cmd=>!['transactions','source_records'].includes(cmd.entity.type)).map(cmd=>cmd.entity));
    const stored=original.fields.posting_plan;
    if(stored!==null&&stored!==undefined&&stored!==expected)throw Error('SETTLEMENT_MISMATCH');
   }
   return [];
  }
  if(original.fields.status!=='PENDING')throw Error('INVALID_STATUS_TRANSITION');
  if(c.status==='FAILED')return [{action:'PATCH_FIELD',entity:{type:'transactions',id:c.transactionId,fields:{status:'FAILED'}}}];
  const settlement=c.settlement;
  if(!settlement||settlement.id!==original.id||settlement.kind!==original.fields.event_type||settlement.amount!==original.fields.display_amount||settlement.occurredAt!==original.fields.occurred_at)throw Error('SETTLEMENT_MISMATCH');
  // Reinterpret the final evidence; retain the original transaction, note and raw records.
  const generated=interpret({...settlement,status:'SUCCESS'},snapshot).filter(cmd=>cmd.entity.type!=='transactions');
  const postings=generated.filter(cmd=>cmd.entity.type!=='source_records');
  const plan=JSON.stringify(postings.map(cmd=>cmd.entity));
  const additions:Command[]=[];
  for(const cmd of generated) {
   const old=get(cmd.entity.type,cmd.entity.id);
   if(!old)additions.push(cmd);
   else if(JSON.stringify(old.fields)!==JSON.stringify(cmd.entity.fields))throw Error('EXISTING_POSTING_MISMATCH');
  }
  return [{action:'PATCH_FIELD',entity:{type:'transactions',id:c.transactionId,fields:{status:'SUCCESS'}}},
   {action:'PATCH_FIELD',entity:{type:'transactions',id:c.transactionId,fields:{posting_plan:plan}}},...additions];
 }
 if(c.kind==='BIND_ACCOUNT'||c.kind==='RESOLVE_ACCOUNT_BINDING') {
  const m=get('balance_movements',c.movementId);
  if(!m)throw Error('MOVEMENT_UNAVAILABLE');
  const parent=get('transactions',m.fields.transaction_id as string);
  if(!parent||parent.fields.deleted_at||parent.fields.status!=='SUCCESS')throw Error('TRANSACTION_UNAVAILABLE');
  const bindingConflicts=snapshot.conflicts.filter(x=>x.entity_type==='balance_movements'&&x.entity_id===m.id);
  if(c.kind==='BIND_ACCOUNT')assertClear('transactions',parent.id);
  else if(!bindingConflicts.length||bindingConflicts.some(x=>!['account_id','amount'].includes(x.field))||snapshot.conflicts.some(x=>x.entity_type==='transactions'&&x.entity_id===parent.id))throw Error('NO_RESOLVABLE_BINDING');
  const target=account(c.accountId)!;
  if(['INTERNAL_TRANSFER','WITHDRAWAL'].includes(parent.fields.event_type as string)) {
   if(target.fields.type!=='ASSET')throw Error('TRANSFER_REQUIRES_ASSET');
   if(entities.some(e=>e.type==='balance_movements'&&e.id!==m.id&&e.fields.transaction_id===parent.id&&e.fields.account_id===c.accountId))throw Error('SAME_ACCOUNT_TRANSFER');
  }
  if(c.kind==='BIND_ACCOUNT'&&m.fields.account_id!==null) {
   if(m.fields.account_id===c.accountId)return [];
   throw Error('ACCOUNT_ALREADY_BOUND');
  }
  const current=m.fields.account_id===null?undefined:account(m.fields.account_id as string);
  const flow=(m.fields.amount as number)*(current?.fields.type==='LIABILITY'?-1:1);
  const amount=flow*(target.fields.type==='LIABILITY'?-1:1);
  if(c.kind==='RESOLVE_ACCOUNT_BINDING')return [{action:'RESOLVE_CONFLICT',entity:{type:'balance_movements',id:m.id,fields:{account_id:c.accountId,amount}}}];
  // Always write both fields, including an unchanged amount, so concurrent bindings stay paired.
  return [{action:'PATCH_FIELD',entity:{type:'balance_movements',id:m.id,fields:{account_id:c.accountId}}},
   {action:'PATCH_FIELD',entity:{type:'balance_movements',id:m.id,fields:{amount}}}];
 }
 if(c.kind==='CREATE_ACCOUNT') {
  identifier(c.id);timestamp(c.openingBalanceAt);
  if(!['ASSET','LIABILITY'].includes(c.accountType))throw Error('INVALID_ACCOUNT_TYPE');
  if(c.openingBalance!==null){money(c.openingBalance,true);}
  if(!c.name?.trim())throw Error('EMPTY_NAME');
  return [create({type:'accounts',id:c.id,fields:{name:c.name,type:c.accountType,
   balance_tracking:c.tracking===false?'DISABLED':'ENABLED',balance_state:c.openingBalance===null?'UNINITIALIZED':'ESTABLISHED',
   opening_balance:c.openingBalance??0,opening_balance_at:c.openingBalanceAt,last4:c.last4??'',deleted_at:null}})];
 }
 if(c.kind==='DELETE_TRANSACTION') {
  timestamp(c.deletedAt);const original=get('transactions',c.transactionId);
  if(!original||original.fields.deleted_at)throw Error('TRANSACTION_UNAVAILABLE');
  const activeReturn=entities.some(e=>e.type==='transaction_links'&&e.fields.to_transaction_id===c.transactionId&&(()=>{const t=get('transactions',e.fields.from_transaction_id as string);return t&&!t.fields.deleted_at&&t.fields.status==='SUCCESS';})());
  if(activeReturn)throw Error('ACTIVE_RETURN_LINKS');
  return [{action:'DELETE_ENTITY',entity:{type:'transactions',id:c.transactionId,fields:{deleted_at:c.deletedAt}}}];
 }
 if(c.kind==='SET_CONSUMPTION') {
  money(c.amount,true);const original=get('transactions',c.transactionId);
  if(!original||original.fields.deleted_at||original.fields.status!=='SUCCESS')throw Error('TRANSACTION_UNAVAILABLE');
  assertClear('transactions',c.transactionId);
  if(!['EXTERNAL_TRANSFER','DEPOSIT','RED_PACKET'].includes(original.fields.event_type as string))throw Error('MEANING_CHANGE_NOT_ALLOWED');
  if(c.amount>(original.fields.display_amount as number))throw Error('CONSUMPTION_EXCEEDS_AMOUNT');
  const linked=entities.filter(e=>e.type==='transaction_links'&&e.fields.to_transaction_id===c.transactionId)
   .some(e=>{const t=get('transactions',e.fields.from_transaction_id as string);return t&&!t.fields.deleted_at&&t.fields.status==='SUCCESS';});
  if(linked)throw Error('LINKED_RETURN_REQUIRES_ALLOCATION');
  const effect=get('consumption_effects',`${c.transactionId}:effect`);if(!effect)throw Error('MISSING_EFFECT');
  return [{action:'PATCH_FIELD',entity:{type:'consumption_effects',id:effect.id,fields:{amount:c.amount}}},
   {action:'PATCH_FIELD',entity:{type:'consumption_effects',id:effect.id,fields:{category_id:c.categoryId}}}];
 }
 const event=c as EventBase;
 identifier(event.id);timestamp(event.occurredAt);
 if(!event.name?.trim())throw Error('EMPTY_NAME');
 const status=event.status??'SUCCESS';if(!['SUCCESS','PENDING','FAILED'].includes(status))throw Error('INVALID_STATUS');
 money(c.amount);
 commands.push(create({type:'transactions',id:c.id,fields:{event_type:c.kind,status,occurred_at:c.occurredAt,
  display_amount:c.amount,display_name:c.name,note:c.note??'',created_at:c.occurredAt,deleted_at:null}}));
 if(c.source) {
  identifier(c.source.id);
  if(!['MANUAL','SCREENSHOT','EXCEL'].includes(c.source.sourceType)||!c.source.platform?.trim()||typeof c.source.rawPayload!=='string')throw Error('INVALID_SOURCE');
  commands.push(create({type:'source_records',id:c.source.id,fields:{transaction_id:c.id,source_type:c.source.sourceType,
   platform:c.source.platform,raw_payload:c.source.rawPayload,created_at:c.occurredAt}}));
 }
 let movementIndex=0;
 const movement=(id:AccountRef,flow:number)=>{
  const a=account(id);
  // Flow > 0 means money arriving; liability balance is remaining debt.
  const amount=a?.fields.type==='LIABILITY'?-flow:flow;
  if(status==='SUCCESS'&&amount!==0)commands.push(create({type:'balance_movements',id:`${c.id}:movement:${movementIndex++}`,
   fields:{transaction_id:c.id,account_id:id,amount,created_at:c.occurredAt}}));
 };
 const effect=(amount:number,categoryId:string|null)=>{
  if(status==='SUCCESS')commands.push(create({type:'consumption_effects',id:`${c.id}:effect`,fields:{transaction_id:c.id,
   amount,category_id:categoryId,subcategory_id:null,effective_at:c.occurredAt,created_at:c.occurredAt}}));
 };
 const different=(from:AccountRef,to:AccountRef)=>{if(from!==null&&from===to)throw Error('SAME_ACCOUNT_TRANSFER');};
 switch(c.kind) {
  case 'PURCHASE':
   if(c.funding&&c.funding!=='OWN'&&c.funding!=='EXTERNAL_SPONSOR')throw Error('INVALID_FUNDING');
   if(c.funding==='EXTERNAL_SPONSOR') {if(c.payer!==null)throw Error('SPONSOR_HAS_OWN_ACCOUNT');}
   else movement(c.payer,-c.amount);
   effect(c.amount,c.categoryId??null);break;
  case 'INCOME':movement(c.destination,c.amount);break;
  case 'INTERNAL_TRANSFER':
   different(c.from,c.to);
   for(const id of [c.from,c.to])if(account(id)?.fields.type==='LIABILITY')throw Error('USE_REPAYMENT_FOR_LIABILITY');
   movement(c.from,-c.amount);movement(c.to,c.amount);break;
  case 'WITHDRAWAL':
   money(c.fee,true);different(c.from,c.to);
   for(const id of [c.from,c.to])if(account(id)?.fields.type==='LIABILITY')throw Error('WITHDRAWAL_REQUIRES_ASSET');
   movement(c.from,-sum([c.amount,c.fee]));movement(c.to,c.amount);
   if(c.fee)effect(c.fee,'fees');break;
  case 'REPAYMENT':
   if(account(c.from)?.fields.type!=='ASSET'||account(c.to)?.fields.type!=='LIABILITY')throw Error('INVALID_REPAYMENT_ACCOUNTS');
   movement(c.from,-c.amount);movement(c.to,c.amount);break;
  case 'EXTERNAL_TRANSFER':case 'DEPOSIT':case 'RED_PACKET':
   money(c.consumptionAmount??0,true);
   if((c.consumptionAmount??0)>c.amount)throw Error('CONSUMPTION_EXCEEDS_AMOUNT');
   movement(c.from,-c.amount);effect(c.consumptionAmount??0,c.categoryId??null);break;
  case 'REFUND':case 'RETURN': {
   const original=get('transactions',c.originalId);
   if(!original||original.fields.deleted_at||original.fields.status!=='SUCCESS')throw Error('ORIGINAL_UNAVAILABLE');
   assertClear('transactions',c.originalId);
   if(c.kind==='REFUND'?original.fields.event_type!=='PURCHASE':!['EXTERNAL_TRANSFER','DEPOSIT','RED_PACKET'].includes(original.fields.event_type as string))throw Error('INVALID_RETURN_KIND');
   if(Date.parse(c.occurredAt)<Date.parse(original.fields.occurred_at as string))throw Error('RETURN_BEFORE_ORIGINAL');
   const links=entities.filter(e=>e.type==='transaction_links'&&e.fields.to_transaction_id===c.originalId);
   const previous=links.map(e=>get('transactions',e.fields.from_transaction_id as string)!).filter(t=>t&&!t.fields.deleted_at&&t.fields.status==='SUCCESS');
   for(const t of previous)assertClear('transactions',t.id);
   const refunded=sum(previous.map(t=>t.fields.display_amount as number));
   if(sum([refunded,c.amount])>(original.fields.display_amount as number))throw Error('RETURN_EXCEEDS_ORIGINAL');
   const originalEffect=get('consumption_effects',`${c.originalId}:effect`);
   const originalConsumption=(originalEffect?.fields.amount as number)??0;
   let reduction=c.consumptionReduction;
   if(reduction===undefined) {
    if(originalConsumption===0)reduction=0;
    else if(originalConsumption===original.fields.display_amount)reduction=c.amount;
    else throw Error('CONSUMPTION_ALLOCATION_REQUIRED');
   }
   money(reduction,true);
   const previousReduction=-sum(previous.map(t=>(get('consumption_effects',`${t.id}:effect`)?.fields.amount as number)??0));
   if(reduction>c.amount||sum([previousReduction,reduction])>originalConsumption)throw Error('REFUND_CONSUMPTION_EXCEEDED');
   const nonConsumed=(original.fields.display_amount as number)-originalConsumption;
   if(sum([refunded-previousReduction,c.amount-reduction])>nonConsumed)throw Error('REFUND_NONCONSUMPTION_EXCEEDED');
   const originalMovements=entities.filter(e=>e.type==='balance_movements'&&e.fields.amount!==0&&e.fields.transaction_id===c.originalId);
   if(originalMovements.length===0) {if(c.destination!==null)throw Error('SPONSORED_REFUND_HAS_OWN_ACCOUNT');}
   else movement(c.destination,c.amount);
   effect(-reduction,(originalEffect?.fields.category_id as string|null)??null);
   commands.push(create({type:'transaction_links',id:`${c.id}:link`,fields:{from_transaction_id:c.id,to_transaction_id:c.originalId,type:c.kind==='REFUND'?'REFUND_OF':'RETURN_OF'}}));
   break;
  }
  default:throw Error('UNSUPPORTED_BUSINESS_COMMAND');
 }
 return commands;
}
