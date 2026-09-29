import type {Entity,Conflict} from '../../../packages/domain/index.ts';
import type {Command} from '../../../packages/accounting/index.ts';
import type {Draft} from './importer.ts';
import {issues,money} from './importer.ts';
import {sourceUTC,hash,compoundChannel} from './normalize.ts';
import {resolveAccount,allowedAccount} from './account-matcher.ts';
export function ruleCommand(entities:Entity[],id:string,value:unknown):Command{
 const old=entities.find(e=>e.type==='import_rules'&&e.id===id);
 return old?{action:'PATCH_FIELD',entity:{type:'import_rules',id,fields:{value:value===null?null:JSON.stringify(value)}}}:{action:'CREATE_ENTITY',entity:{type:'import_rules',id,fields:{rule_key:id,value:value===null?null:JSON.stringify(value)}}};
}
export function ruleValue(entities:Entity[],id:string):any{const e=entities.find(e=>e.type==='import_rules'&&e.id===id);try{return e?.fields.value?JSON.parse(String(e.fields.value)):undefined;}catch{return undefined;}}
export function sourcePayload(d:Draft){return {version:2,identity:d.identity||d.key,profile:d.profile||'本人',key:d.key,order:d.order,sourceClass:d.sourceClass,channel:d.channel,original:d.raw,parserVersion:2,timezone:'Asia/Shanghai',precision:d.precision};}
export function existingSource(d:Draft,entities:Entity[]){
 const linked=ruleValue(entities,'source-'+(d.identity||d.key));const ids=new Set<string>();if(linked?.transactionId)ids.add(linked.transactionId);
 for(const s of entities.filter(e=>e.type==='source_records')){
  let p:any;try{p=JSON.parse(String(s.fields.raw_payload));}catch{continue;}
  // Legacy records lack profile and stable event identity: block unsafe re-import, do not rewrite.
  if(p.identity===(d.identity||d.key)||s.id==='source-'+d.key||d.order&&p.order===d.order&&s.fields.platform===d.platform&&(!p.profile||p.profile===d.profile))ids.add(String(s.fields.transaction_id));
 }
 return entities.filter(e=>e.type==='transactions'&&ids.has(e.id));
}
export function identicalInterpretation(d:Draft,t:Entity){try{return t.fields.event_type===d.kind&&t.fields.status===d.status&&t.fields.display_amount===money(d.amount)&&t.fields.occurred_at===sourceUTC(d.date);}catch{return false;}}
export function reviewDraft(d:Draft,entities:Entity[],conflicts:Conflict[]){
 const ac=entities.filter(e=>e.type==='accounts'),rules=entities.filter(e=>e.type==='import_rules');
 for(const r of ['account','to'] as const){const result=resolveAccount(d,ac,rules,conflicts,r);const hint=result.reason+(result.candidates.length?'：'+result.candidates.map(id=>ac.find(a=>a.id===id)?.fields.name||id).join(' / '):'');if(r==='account')d.accountHint=hint;else d.toHint=hint;if(d[r+'Mode' as 'accountMode'|'toMode']!=='manual'){d[r]=result.id;if(r==='account')d.accountMode=result.id?'alias':'';else d.toMode=result.id?'alias':'';}}
 if(ruleValue(entities,'ignore-'+(d.identity||d.key))?.ignored){if(d.workflow!=='ignored')d.selected=false;d.workflow='ignored';}
 const existing=existingSource(d,entities);
 if(existing.length){d.transactionId=existing[0].id;d.workflow=d.workflow==='committed'?'committed':'linked';d.selected=false;d.issue=existing.length>1?'同一来源对应多笔旧交易，请核验':identicalInterpretation(d,existing[0])?(existing[0].fields.deleted_at?'原交易在回收站，不重复导入':'来源已存在，不重复入账'):'已有来源的状态/类型/金额/时间不同，请核验；不会新增交易';return d;}
 if(d.status==='FAILED'){d.workflow='noeffect';d.selected=false;d.issue='失败记录已保留，无账务影响';return d;}
 const problems=issues(d);try{money(d.amount);}catch{problems.push('核对有效金额');}try{sourceUTC(d.date);}catch{problems.push('补充完整时间');}
 if(!d.name.trim())problems.push('补充交易名称');if(d.status==='UNKNOWN')problems.push('确认状态');if(d.kind==='UNKNOWN')problems.push('确认交易性质');
 if(['REFUND','RETURN'].includes(d.kind)&&!d.original)problems.push('关联原交易');
 if(d.status==='SUCCESS'&&!(d.sponsor&&d.kind==='PURCHASE')){
  const a=ac.find(a=>a.id===d.account);if(d.account&&(!a||!allowedAccount(d,a,'account')))problems.push('付款/到账账户不适用');
  if(!d.account&&!(d.confirmed||[]).includes('ACCOUNT'))problems.push('确认资金账户或明确稍后补认');
  if(['REPAYMENT','INTERNAL_TRANSFER','WITHDRAWAL'].includes(d.kind)){const to=ac.find(a=>a.id===d.to);if(!to||!allowedAccount(d,to,'to'))problems.push('确认有效转入账户');if(!d.account)problems.push('确认转出账户');}
 }
 if(conflicts.some(c=>c.entity_type==='import_rules'))problems.push('先处理账户关系/来源的同步冲突');
 d.issue=[...new Set(problems)].join('；');return d;
}
export function groupKey(d:Draft){return JSON.stringify([d.platform,d.profile||'本人',d.kind,d.status,d.channel,d.workflow==='deferred'?'deferred':'active']);}
export function safeCandidates(d:Draft,entities:Entity[]){
 let amount:number,at:number;try{amount=money(d.amount);at=Date.parse(sourceUTC(d.date));}catch{return [];}
 return entities.filter(e=>e.type==='transactions'&&!e.fields.deleted_at&&e.fields.display_amount===amount&&e.fields.event_type===d.kind&&Math.abs(Date.parse(String(e.fields.occurred_at))-at)<86400000);
}
export function auditSources(entities:Entity[]){return entities.filter(e=>e.type==='source_records').flatMap(s=>{
 let p:any;try{p=JSON.parse(String(s.fields.raw_payload));}catch{return [];}
 if(p.version===2||!p.order)return [];const t=entities.find(e=>e.type==='transactions'&&e.id===s.fields.transaction_id);if(!t)return [];
 const reasons=[];const raw=String(p.original||'');if(t.fields.event_type==='PURCHASE'&&/花呗.{0,12}还款|主动还款|自动还款|退款成功/.test(raw))reasons.push('类型可能需核验');if(compoundChannel(String(p.channel||'')))reasons.push('组合支付资金分摊');if(!reasons.length)reasons.push('旧来源未记录归属/来源时区，重导需核验');
 return [{id:t.id,name:String(t.fields.display_name),source:s.id,reasons}];
 });}
