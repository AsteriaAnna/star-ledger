import {channelKey,emptyChannel} from './normalize.ts';
export type Channel = {name:string;type:'ASSET'|'LIABILITY';last4:string;bank:string;identity:string};
// These tokens describe checkout benefits, not a second personal bank/wallet account.
export function paymentChannel(raw:string){
 const parts=channelKey(raw).split(/[&＆+＋]/).map(s=>s.trim()).filter(Boolean);
 const promotion=(s:string)=>/^(?:红包|闪购红包|淘宝闪购红包|支付宝红包|商家红包|优惠券|立减金|集分宝)(?:\([^)]*\))?$/.test(s);
 const discounts=parts.filter(promotion),funding=parts.filter(s=>!promotion(s));
 return {channel:funding.length===1?funding[0]:'',discounts,compound:funding.length>1||/组合支付|组合付款/.test(raw)};
}
const banks:Record<string,string>={中国农业银行:'农业银行',农业银行:'农业银行',农行:'农业银行',中国工商银行:'工商银行',工商银行:'工商银行',工行:'工商银行',中国建设银行:'建设银行',建设银行:'建设银行',建行:'建设银行',招商银行:'招商银行',招行:'招商银行',中国银行:'中国银行',中行:'中国银行',交通银行:'交通银行',交行:'交通银行'};
export function bankName(raw:string){for(const [key,name]of Object.entries(banks))if(raw.includes(key))return name;return raw.match(/([\u4e00-\u9fff]+银行)/)?.[1]||'';}
export function describeChannel(platform:string,raw:string):Channel|undefined{
 const s=paymentChannel(raw).channel;if(emptyChannel(s)||/亲情卡|亲属卡/.test(s))return;
 const wallet:Record<string,[string,'ASSET'|'LIABILITY']>={
  '微信:零钱':['微信零钱','ASSET'],'微信:零钱通':['微信零钱通','ASSET'],
  '支付宝:余额':['支付宝余额','ASSET'],'支付宝:支付宝余额':['支付宝余额','ASSET'],
  '支付宝:余额宝':['余额宝','ASSET'],'支付宝:花呗':['花呗','LIABILITY']};
 const w=wallet[platform+':'+s];if(w)return {name:w[0],type:w[1],last4:'',bank:'',identity:platform+':'+s};
 const last4=s.match(/(?:\(|尾号\s*)(\d{4})\)?$/)?.[1]||'',bank=bankName(s);
 if(bank&&last4&&/储蓄卡|借记卡|信用卡|贷记卡/.test(s))return {name:s,type:/信用卡|贷记卡/.test(s)?'LIABILITY':'ASSET',last4,bank,identity:bank+':'+(/信用卡|贷记卡/.test(s)?'credit':'debit')+':'+last4};
}
export function roleChannel(d:{kind:string;channel:string;raw:string},role:'account'|'to'){
 return role==='to'&&d.kind==='REPAYMENT'&&/花呗/.test(d.raw)?'花呗':role==='account'?paymentChannel(d.channel).channel:'';
}
export const needsSplit=(channel:string)=>paymentChannel(channel).compound;
