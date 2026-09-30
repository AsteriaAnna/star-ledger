import type {Entity,Conflict} from '../../../packages/domain/index.ts';
import type {Draft} from './importer.ts';
import {hash,channelKey,emptyChannel} from './normalize.ts';
import {describeChannel,roleChannel,needsSplit,bankName} from './channels.ts';
export type Role='account'|'to';
export const roleName=(d:Draft,r:Role)=>r==='to'?'转入账户':['INCOME','TRANSFER_IN','REFUND','RETURN'].includes(d.kind)?'到账账户':'付款账户';
export function allowedAccount(d:Pick<Draft,'kind'|'account'|'to'|'sponsor'>,a:Entity,r:Role){
 if(a.fields.deleted_at)return false;if(d.sponsor&&['PURCHASE','REFUND','RETURN'].includes(d.kind))return false;
 if(r==='to'&&!['REPAYMENT','INTERNAL_TRANSFER','WITHDRAWAL'].includes(d.kind))return false;
 if(d.kind==='REPAYMENT')return a.fields.type===(r==='to'?'LIABILITY':'ASSET')&&(r==='account'||a.id!==d.account);
 if(['INTERNAL_TRANSFER','WITHDRAWAL'].includes(d.kind))return a.fields.type==='ASSET'&&a.id!==(r==='to'?d.account:d.to);
 return true;
}
export function aliasScope(d:Draft,r:Role){return {v:1,platform:d.platform,profile:d.profile||'本人',channel:channelKey(roleChannel(d,r)),role:r==='to'?'repayment-target':roleName(d,r)};}
export function aliasId(d:Draft,r:Role){return 'alias-'+hash(aliasScope(d,r));}
export function instrumentId(d:Draft,r:Role){const desc=describeChannel(d.platform,roleChannel(d,r));return desc?'instrument-'+hash([d.profile||'本人',desc.identity]):'';}
export function canRemember(d:Draft,r:Role){return !d.sponsor&&!emptyChannel(roleChannel(d,r))&&!needsSplit(d.channel)&&['微信','支付宝'].includes(d.platform)&&!!d.profile;}
export function resolveAccount(d:Draft,accounts:Entity[],rules:Entity[],conflicts:Conflict[],r:Role='account'){
 const current=d[r],mode=r==='account'?d.accountMode:d.toMode;
 if(current&&mode==='manual')return allowedAccount(d,accounts.find(a=>a.id===current)||{type:'accounts',id:'missing',fields:{deleted_at:'missing'}} as Entity,r)?{id:current,state:'confirmed',reason:'本条已确认',candidates:[current]}:{id:'',state:'invalid',reason:'已选账户不再适用',candidates:[]};
 if(d.sponsor&&['PURCHASE','REFUND','RETURN'].includes(d.kind))return {id:'',state:'none',reason:'他人代付，不动本人账户',candidates:[]};
 const valid=accounts.filter(a=>allowedAccount(d,a,r));const key=aliasId(d,r),instrument=instrumentId(d,r),rule=rules.find(a=>a.id===key)||rules.find(a=>instrument&&a.id===instrument&&a.fields.value!==null);
 if(conflicts.some(c=>c.entity_type==='import_rules'&&(c.entity_id===key||!!instrument&&c.entity_id===instrument)))return {id:'',state:'conflict',reason:'此渠道存在两个不同账户选择',candidates:[]};
 if(rule&&rule.fields.value!==null){let v:any;try{v=JSON.parse(String(rule.fields.value));}catch{}if(v?.accountId){const a=valid.find(a=>a.id===v.accountId);return a?{id:a.id,state:'confirmed',reason:'已记住的渠道关系',candidates:[a.id]}:{id:'',state:'invalid',reason:'已记忆账户不再适用，请重新选择',candidates:[]};}}
 const channel=roleChannel(d,r);
 if(emptyChannel(channel)||needsSplit(d.channel)&&r==='account')return {id:'',state:'unknown',reason:needsSplit(d.channel)?'包含多个付款账户':'来源未提供资金账户',candidates:[]};
 const desc=describeChannel(d.platform,channel);
 // Exact identities (bank + card type + tail), or platform-specific wallets, may resolve on first use.
 const candidates=valid.filter(a=>{
  if(desc&&a.fields.type!==desc.type)return false;
  const name=channelKey(String(a.fields.name));
  if(name===channel||desc&&name===desc.name)return true;
  if(desc?.last4)return (a.fields.last4===desc.last4||name.includes('('+desc.last4+')'))&&bankName(name)===desc.bank;
  if(d.platform==='微信'&&channel==='零钱')return /^(微信零钱|微信余额|零钱)$/.test(name);
  if(d.platform==='支付宝'&&channel==='余额')return /^(支付宝余额|余额)$/.test(name);
  return false;
 }).map(a=>a.id);
 if(candidates.length===1&&(!d.profile||d.profile==='本人'))return {id:candidates[0],state:'matched',reason:'按明确渠道自动识别',candidates};
 const weak=candidates.length?candidates:desc?.last4?valid.filter(a=>a.fields.last4===desc.last4).map(a=>a.id):[];
 return {id:'',state:weak.length?'suggested':'unknown',reason:weak.length?'请选择对应账户':'可按渠道新建或绑定已有账户',candidates:weak};
}
export function applyAccounts(drafts:Draft[],indexes:number[],accountId:string,r:Role,accounts:Entity[],replace=false){
 const a=accounts.find(a=>a.id===accountId);if(!a)throw Error('请选择账户');const changes:{index:number;before:string;after:string}[]=[];
 for(const i of indexes){const d=drafts[i];if(!d||!d.selected||['committed','linked','ignored','noeffect'].includes(d.workflow||'')||!allowedAccount(d,a,r)||needsSplit(d.channel))continue;if(d[r]&&!replace)continue;changes.push({index:i,before:d[r],after:a.id});}
 return changes;
}
// One decision per instrument, shared by payment/refund/repayment roles in this setup screen.
export function accountSetupGroups(drafts:Draft[],accounts:Entity[],rules:Entity[],conflicts:Conflict[]){
 const groups=new Map<string,{key:string;descriptor:ReturnType<typeof describeChannel>;label:string;platform:string;items:{index:number;role:Role}[];candidates:string[]}>();
 drafts.forEach((d,index)=>{
  if(d.status!=='SUCCESS'||['committed','linked','ignored','noeffect','deferred'].includes(d.workflow||''))return;
  for(const role of ['account','to'] as Role[]){
   if(role==='to'&&!['REPAYMENT','INTERNAL_TRANSFER','WITHDRAWAL'].includes(d.kind))continue;
   if(d.sponsor&&['PURCHASE','REFUND','RETURN'].includes(d.kind))continue;
   if(d[role]||needsSplit(d.channel))continue;
   const channel=roleChannel(d,role);if(emptyChannel(channel))continue;
   const descriptor=describeChannel(d.platform,channel),key=JSON.stringify([d.profile||'本人',descriptor?.identity||d.platform+':'+channel]);
   const result=resolveAccount(d,accounts,rules,conflicts,role);
   const g=groups.get(key)||{key,descriptor,label:channel,platform:d.platform,items:[],candidates:result.candidates};
   g.items.push({index,role});groups.set(key,g);
  }
 });return [...groups.values()];
}
