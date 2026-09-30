import type {MemoryStore} from './store.ts';
import {BusinessAccountingService} from '../../../packages/accounting/business.ts';
import {resolveRefund,storedRefundDraft} from './refund-matcher.ts';
export function linkAvailableRefunds(store:MemoryStore){
 const service=new BusinessAccountingService(store,store.state.device);let count=0;
 for(const t of [...store.entities].filter(e=>e.type==='transactions'&&!e.fields.deleted_at&&e.fields.status==='SUCCESS'&&['REFUND','RETURN'].includes(String(e.fields.event_type)))){
  if(store.entities.some(e=>e.type==='transaction_links'&&e.fields.from_transaction_id===t.id))continue;
  const d=storedRefundDraft(t,store.entities);if(!d)continue;const match=resolveRefund(d,store.entities);if(!match.id)continue;
  const ms=store.entities.filter(e=>e.type==='balance_movements'&&e.fields.transaction_id===t.id&&e.fields.amount!==0);
  // An explicit own-account receipt contradicts an externally funded original; leave the link for review.
  if(match.sponsor&&ms.some(m=>m.fields.account_id!==null))continue;
  service.execute({kind:'LINK_RETURN',transactionId:t.id,originalId:match.id});count++;
 }return count;
}
