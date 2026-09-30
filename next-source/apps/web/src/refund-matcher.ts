import type {Entity} from '../../../packages/domain/index.ts';
import type {Draft} from './importer.ts';
import {money} from './importer.ts';
import {sourceUTC} from './normalize.ts';
export const importTransactionId=(d:Draft)=>d.transactionId||'import-'+(d.identity||d.key);
export function originalOrderCandidates(d:Draft){
 if(d.originalOrder)return [d.originalOrder];
 if(d.platform!=='支付宝')return [];
 const at=d.order.search(/\*|_/);return at>0?[d.order.slice(0,at)]:[];
}
function rawFields(d:Draft):Record<string,string>{try{return JSON.parse(d.raw);}catch{return {};}}
function merchant(value:string){return value.replace(/[-－—]退款$|^退款[-－—]?|\s/g,'');}
export function refundContext(entities:Entity[],drafts:Draft[]){
 const result=[...entities];
 for(const d of drafts){
  if(!['PURCHASE','EXTERNAL_TRANSFER','DEPOSIT','RED_PACKET'].includes(d.kind)||d.status!=='SUCCESS'||['ignored','noeffect','deferred'].includes(d.workflow||''))continue;
  const id=importTransactionId(d);if(result.some(t=>t.type==='transactions'&&t.id===id))continue;
  let amount:number,occurred:string;try{amount=money(d.amount);occurred=sourceUTC(d.date);}catch{continue;}
  result.push({type:'transactions',id,fields:{event_type:d.kind,display_name:d.name,display_amount:amount,occurred_at:occurred,status:'SUCCESS',deleted_at:null,note:d.note}},
   {type:'source_records',id:id+':preview-source',fields:{transaction_id:id,platform:d.platform,raw_payload:JSON.stringify({order:d.order,profile:d.profile,original:d.raw})}},
   {type:'consumption_effects',id:id+':effect',fields:{transaction_id:id,amount:d.kind==='PURCHASE'?amount:0,category_id:d.category}});
  if(!d.sponsor)result.push({type:'balance_movements',id:id+':movement:0',fields:{transaction_id:id,account_id:d.account||null,amount:-amount}});
 }return result;
}
export function resolveRefund(d:Draft,entities:Entity[]){
 const none={id:'',account:'',sponsor:d.sponsor,reason:'退款已识别，可先入账，原交易稍后关联',candidates:[] as string[]};
 if(!['REFUND','RETURN'].includes(d.kind))return none;
 let amount:number,at:number;try{amount=money(d.amount);at=Date.parse(sourceUTC(d.date));}catch{return none;}
 if(d.originalMode==='manual'&&!d.original)return none;
 const orderKeys=originalOrderCandidates(d),raw=rawFields(d);
 const sourceById=new Map<string,any[]>();
 for(const s of entities.filter(e=>e.type==='source_records'&&e.fields.platform===d.platform)){try{const p=JSON.parse(String(s.fields.raw_payload));if(p.profile&&p.profile!==(d.profile||'本人'))continue;const id=String(s.fields.transaction_id);sourceById.set(id,[...(sourceById.get(id)||[]),p]);}catch{}}
 const candidates=entities.filter(t=>{
  if(t.type!=='transactions'||t.fields.deleted_at||t.fields.status!=='SUCCESS'||(d.kind==='REFUND'?t.fields.event_type!=='PURCHASE':!['EXTERNAL_TRANSFER','DEPOSIT','RED_PACKET'].includes(String(t.fields.event_type))))return false;
  const delta=at-Date.parse(String(t.fields.occurred_at));if(delta<0)return false;
  const previous=entities.filter(e=>e.type==='transaction_links'&&e.fields.to_transaction_id===t.id).map(e=>entities.find(t=>t.type==='transactions'&&t.id===e.fields.from_transaction_id)).filter(t=>t&&!t.fields.deleted_at&&t.fields.status==='SUCCESS').reduce((n,t)=>n+Number(t!.fields.display_amount),0);
  if(amount+previous>Number(t.fields.display_amount))return false;
  if(d.originalMode==='manual')return t.id===d.original;
  const consumption=Number(entities.find(e=>e.type==='consumption_effects'&&e.fields.transaction_id===t.id)?.fields.amount||0);
  if(d.kind==='RETURN'&&consumption>0&&consumption!==Number(t.fields.display_amount)&&amount!==Number(t.fields.display_amount))return false;
  const sources=sourceById.get(t.id)||[];
  if(orderKeys.length)return sources.some(p=>orderKeys.includes(p.order));
  if(d.platform!=='微信'||delta>90*86400000||Number(t.fields.display_amount)!==amount||!sources.length)return false;
  const name=merchant(d.name),type=merchant(raw['交易类型']||'');
  if(d.kind==='RETURN'&&(!raw['交易对方']||raw['交易对方']==='/')){const remark=raw['商品']||'';return !!remark&&remark!=='/'&&sources.some(p=>{try{const original=JSON.parse(p.original||'{}');return original['商品']===remark;}catch{return false;}});}
  return !!name&&(merchant(String(t.fields.display_name))===name||!!type&&merchant(String(t.fields.display_name))===type);
 });
 if(candidates.length!==1)return {...none,candidates:candidates.map(t=>t.id),reason:candidates.length?'有多个原交易候选，可入账后关联':none.reason};
 const t=candidates[0],ms=entities.filter(e=>e.type==='balance_movements'&&e.fields.transaction_id===t.id&&e.fields.amount!==0);
 return {id:t.id,account:String(ms[0]?.fields.account_id||''),sponsor:ms.length===0,reason:orderKeys.length?'已按原订单号关联':'已按唯一商户/对方、全额金额与时间关联',candidates:[t.id]};
}
export function storedRefundDraft(t:Entity,entities:Entity[]):Draft|undefined{
 const s=entities.find(e=>e.type==='source_records'&&e.fields.transaction_id===t.id);if(!s)return;
 let p:any;try{p=JSON.parse(String(s.fields.raw_payload));}catch{return;}
 return {key:p.key||t.id,identity:p.identity,platform:String(s.fields.platform),profile:p.profile||'本人',name:String(t.fields.display_name),amount:String(Number(t.fields.display_amount)/100),date:new Date(Date.parse(String(t.fields.occurred_at))+8*3600000).toISOString().slice(0,19),kind:String(t.fields.event_type),status:'SUCCESS',channel:p.channel||'',account:'',to:'',category:'其他',original:'',note:String(t.fields.note||''),raw:p.original||'{}',issue:'',selected:false,sourceType:'EXCEL',order:p.order||'',originalOrder:p.originalOrder||'',sponsor:false,consumption:'0'};
}
