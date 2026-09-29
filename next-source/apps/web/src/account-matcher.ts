import type {Entity,Conflict} from '../../../packages/domain/index.ts';
import type {Draft} from './importer.ts';
import {hash,channelKey,emptyChannel,compoundChannel} from './normalize.ts';
export type Role='account'|'to';
export const roleName=(d:Draft,r:Role)=>r==='to'?'转入账户':['INCOME','REFUND','RETURN'].includes(d.kind)?'到账账户':'付款账户';
export function allowedAccount(d:Pick<Draft,'kind'|'account'|'to'|'sponsor'>,a:Entity,r:Role){
 if(a.fields.deleted_at)return false;if(d.kind==='PURCHASE'&&d.sponsor)return false;
 if(r==='to'&&!['REPAYMENT','INTERNAL_TRANSFER','WITHDRAWAL'].includes(d.kind))return false;
 if(d.kind==='REPAYMENT')return a.fields.type===(r==='to'?'LIABILITY':'ASSET')&&(r==='account'||a.id!==d.account);
 if(['INTERNAL_TRANSFER','WITHDRAWAL'].includes(d.kind))return a.fields.type==='ASSET'&&a.id!==(r==='to'?d.account:d.to);
 return true;
}
export function aliasScope(d:Draft,r:Role){return {v:1,platform:d.platform,profile:d.profile||'本人',channel:channelKey(d.channel),role:r==='to'?'repayment-target':roleName(d,r)};}
export function aliasId(d:Draft,r:Role){return 'alias-'+hash(aliasScope(d,r));}
export function canRemember(d:Draft,r:Role){return r==='account'&&!d.sponsor&&!emptyChannel(d.channel)&&!compoundChannel(d.channel)&&['微信','支付宝'].includes(d.platform)&&!!d.profile;}
export function resolveAccount(d:Draft,accounts:Entity[],rules:Entity[],conflicts:Conflict[],r:Role='account'){
 const current=d[r],mode=r==='account'?d.accountMode:d.toMode;
 if(current&&mode==='manual')return allowedAccount(d,accounts.find(a=>a.id===current)||{type:'accounts',id:'missing',fields:{deleted_at:'missing'}} as Entity,r)?{id:current,state:'confirmed',reason:'本条已确认',candidates:[current]}:{id:'',state:'invalid',reason:'已选账户不再适用',candidates:[]};
 if(d.sponsor&&d.kind==='PURCHASE')return {id:'',state:'none',reason:'他人代付，不动本人账户',candidates:[]};
 const valid=accounts.filter(a=>allowedAccount(d,a,r));const key=aliasId(d,r),rule=rules.find(a=>a.id===key);
 if(conflicts.some(c=>c.entity_type==='import_rules'&&c.entity_id===key))return {id:'',state:'conflict',reason:'账户关系存在同步冲突',candidates:[]};
 if(rule&&rule.fields.value!==null){let v:any;try{v=JSON.parse(String(rule.fields.value));}catch{}if(v?.accountId){const a=valid.find(a=>a.id===v.accountId);return a?{id:a.id,state:'confirmed',reason:'按你之前确认的关系',candidates:[a.id]}:{id:'',state:'invalid',reason:'已记忆账户不再适用，请重新选择',candidates:[]};}}
 if(r==='account'&&(emptyChannel(d.channel)||compoundChannel(d.channel)))return {id:'',state:'unknown',reason:compoundChannel(d.channel)?'组合支付，不能整笔匹配单账户':'未提供资金渠道',candidates:[]};
 const channel=channelKey(d.channel),last=channel.match(/(?:\(|尾号\s*)(\d{4})(?:\)|$)/)?.[1];
 const candidates=valid.filter(a=>{
  const name=String(a.fields.name);
  if(r==='to')return d.kind==='REPAYMENT'&&/花呗/.test(d.raw)&&/花呗/.test(name);
  if(last)return a.fields.last4===last;
  if(d.platform==='微信'&&channel==='零钱')return /微信.*(?:余额|零钱)|^零钱$/.test(name)&&a.fields.type==='ASSET';
  if(d.platform==='支付宝'&&channel==='余额')return /支付宝.*余额|^余额$/.test(name)&&a.fields.type==='ASSET';
  if(channel==='花呗')return /花呗/.test(name)&&a.fields.type==='LIABILITY';
  return name===channel;
 }).map(a=>a.id);
 return {id:'',state:candidates.length?'suggested':'unknown',reason:candidates.length>1?'多个候选，请选择':candidates.length?'建议账户，首次请确认':'未找到可靠账户',candidates};
}
export function applyAccounts(drafts:Draft[],indexes:number[],accountId:string,r:Role,accounts:Entity[],replace=false){
 const a=accounts.find(a=>a.id===accountId);if(!a)throw Error('请选择账户');const changes:{index:number;before:string;after:string}[]=[];
 for(const i of indexes){const d=drafts[i];if(!d||!d.selected||['committed','ignored','noeffect'].includes(d.workflow||'')||!allowedAccount(d,a,r)||compoundChannel(d.channel))continue;if(d[r]&&!replace)continue;changes.push({index:i,before:d[r],after:a.id});}
 return changes;
}
