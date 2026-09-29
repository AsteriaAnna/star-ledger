import type {Entity} from '../domain/index.ts';
import type {LedgerSnapshot} from '../accounting/index.ts';

export function addMoney(values:number[]):number {
 return values.reduce((sum,value)=>{const next=sum+value;if(!Number.isSafeInteger(next))throw Error('MONEY_OVERFLOW');return next;},0);
}
function time(value:string):number {const n=Date.parse(value);if(!Number.isFinite(n))throw Error('INVALID_TIMESTAMP');return n;}
function transaction(snapshot:LedgerSnapshot,id:string):Entity|undefined {
 return snapshot.entities.find(e=>e.type==='transactions'&&e.id===id&&e.fields.deleted_at===null&&e.fields.status==='SUCCESS');
}
function clear(snapshot:LedgerSnapshot):void {
 // Fail closed until UI can show unresolved portions alongside confirmed totals.
 if(snapshot.conflicts.length)throw Error('UNRESOLVED_CONFLICT');
}
export type BalanceResult={accountId:string;balance:number|null;state:'ESTABLISHED'|'UNINITIALIZED'|'DISABLED';
 includedMovements:number;excludedHistoricalMovements:number};
export function accountBalance(snapshot:LedgerSnapshot,accountId:string,asOf:string):BalanceResult {
 clear(snapshot);const end=time(asOf);
 const account=snapshot.entities.find(e=>e.type==='accounts'&&e.id===accountId&&!e.fields.deleted_at);
 if(!account)throw Error('ACCOUNT_UNAVAILABLE');
 const base={accountId,balance:null,includedMovements:0,excludedHistoricalMovements:0};
 if(account.fields.balance_tracking==='DISABLED')return {...base,state:'DISABLED'};
 if(account.fields.balance_state==='UNINITIALIZED')return {...base,state:'UNINITIALIZED'};
 const start=time(account.fields.opening_balance_at as string);if(end<start)throw Error('BEFORE_OPENING_BALANCE');
 const movements=snapshot.entities.filter(e=>e.type==='balance_movements'&&e.fields.account_id===accountId)
  .map(e=>({e,t:transaction(snapshot,e.fields.transaction_id as string)})).filter(x=>x.t&&time(x.t.fields.occurred_at as string)<=end);
 const included=movements.filter(x=>time(x.t!.fields.occurred_at as string)>start);
 return {accountId,state:'ESTABLISHED',balance:addMoney([account.fields.opening_balance as number,...included.map(x=>x.e.fields.amount as number)]),
  includedMovements:included.length,excludedHistoricalMovements:movements.length-included.length};
}
export function consumptionInPeriod(snapshot:LedgerSnapshot,startInclusive:string,endExclusive:string):number {
 clear(snapshot);const start=time(startInclusive),end=time(endExclusive);if(start>=end)throw Error('INVALID_PERIOD');
 return addMoney(snapshot.entities.filter(e=>e.type==='consumption_effects'&&transaction(snapshot,e.fields.transaction_id as string))
  .filter(e=>{const date=time(e.fields.effective_at as string);return date>=start&&date<end;}).map(e=>e.fields.amount as number));
}
export function unresolvedMovements(snapshot:LedgerSnapshot):Entity[] {
 clear(snapshot);return snapshot.entities.filter(e=>e.type==='balance_movements'&&e.fields.account_id===null&&e.fields.amount!==0&&transaction(snapshot,e.fields.transaction_id as string));
}
