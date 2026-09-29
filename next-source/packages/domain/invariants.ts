import type {Entity} from './index.ts';
export type FinancialIssue={transactionId:string;code:string;involved:string[]};
/** Cross-event constraints must be rechecked after merging independent device histories. */
export function financialIssues(entities:Entity[]):FinancialIssue[] {
 const txs=entities.filter(e=>e.type==='transactions');
 const get=(id:string)=>txs.find(e=>e.id===id);
 const active=(t:Entity|undefined)=>t&&t.fields.deleted_at===null&&t.fields.status==='SUCCESS';
 const consumption=(id:string)=>entities.filter(e=>e.type==='consumption_effects'&&e.fields.transaction_id===id)
  .reduce((n,e)=>n+(e.fields.amount as number),0);
 const groups=new Map<string,Entity[]>();const issues:FinancialIssue[]=[];
 for(const link of entities.filter(e=>e.type==='transaction_links')) {
  const from=get(link.fields.from_transaction_id as string);if(!active(from))continue;
  const target=link.fields.to_transaction_id as string;
  const entries=groups.get(target)??[];
  if(!entries.some(e=>e.id===from!.id))entries.push(from!);
  groups.set(target,entries);
 }
 for(const t of txs.filter(t=>active(t)&&['INTERNAL_TRANSFER','WITHDRAWAL'].includes(t.fields.event_type as string))) {
  const movements=entities.filter(e=>e.type==='balance_movements'&&e.fields.transaction_id===t.id);
  const known=movements.map(e=>e.fields.account_id).filter(id=>id!==null);
  if(new Set(known).size!==known.length)issues.push({transactionId:t.id,code:'SAME_ACCOUNT_TRANSFER',involved:[t.id]});
 }
 for(const [id,returns] of groups) {
  const original=get(id),involved=[id,...returns.map(e=>e.id)].sort();
  const issue=(code:string)=>issues.push({transactionId:id,code,involved});
  if(!active(original)){issue('RETURN_ORIGINAL_UNAVAILABLE');continue;}
  const amount=original!.fields.display_amount as number,used=returns.reduce((n,e)=>n+(e.fields.display_amount as number),0);
  const originalConsumption=consumption(id),reduction=-returns.reduce((n,e)=>n+consumption(e.id),0);
  if(!Number.isSafeInteger(used)||!Number.isSafeInteger(reduction)){issue('MONEY_OVERFLOW');continue;}
  if(used>amount)issue('RETURN_EXCEEDS_ORIGINAL');
  else if(reduction<0||reduction>originalConsumption||reduction>used)issue('RETURN_CONSUMPTION_INVALID');
  else if(used-reduction>amount-originalConsumption)issue('RETURN_NONCONSUMPTION_INVALID');
 }
 return issues;
}
