import {hash,money,wallDate,compoundChannel} from './normalize.ts';
export {money} from './normalize.ts';
export type Draft={key:string;platform:string;name:string;amount:string;date:string;kind:string;status:string;channel:string;account:string;to:string;category:string;original:string;note:string;raw:string;issue:string;selected:boolean;sourceType:'EXCEL'|'SCREENSHOT';order:string;sponsor:boolean;consumption:string;
 profile?:string;batch?:string;itemId?:string;identity?:string;sourceClass?:string;originalOrder?:string;precision?:string;blockers?:string[];confirmed?:string[];accountMode?:string;toMode?:string;accountHint?:string;toHint?:string;workflow?:string;transactionId?:string;fee?:string;parserVersion?:number;};
export function csv(text:string):string[][]{const rows:string[][]=[];let row:string[]=[],v='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){v+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(v);v='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(v);if(row.some(x=>x.trim()))rows.push(row);row=[];v='';}else v+=c;}row.push(v);if(row.some(x=>x.trim()))rows.push(row);return rows;}
const clean=(v:any)=>v instanceof Date?v.toISOString().slice(0,19):String(v??'').replace(/^\uFEFF/,'').trim();
const norm=(s:string)=>s.replace(/[\s（()）]/g,'');
export function parseRows(rows:any[][],config:{profile?:string;batch?:string;platform?:string;columns?:Record<string,string>}={}):Draft[]{
 const index=rows.findIndex(row=>row.map(clean).some(v=>/交易时间|付款时间|交易创建时间/.test(v))&&row.map(clean).some(v=>/金额/.test(v)));
 if(index<0)throw Error('没有找到交易时间与金额表头。请使用微信/支付宝官方账单。');
 const headers=rows[index].map(v=>norm(clean(v)));const intro=rows.slice(0,index).flat().map(clean).join(' ');
 const platform=config.platform||(/微信/.test(intro)||headers.includes('交易单号')?'微信':/支付宝/.test(intro)||headers.includes('交易订单号')?'支付宝':'未知模板');
 const cell=(row:any[],...keys:string[])=>{for(const k of keys){const n=headers.indexOf(norm(config.columns?.[k]||k));if(n>=0)return clean(row[n]);}return '';};
 const batch=config.batch||hash(rows),profile=config.profile||'本人';const out:Draft[]=[];
 for(const [rowIndex,row]of rows.slice(index+1).entries()){
  const dt=cell(row,'交易时间','付款时间','交易创建时间');if(!dt||/合计|总计|说明/.test(dt))continue;
  const rawAmount=cell(row,'金额元','金额','交易金额元','交易金额');if(!rawAmount)continue;
  const type=cell(row,'交易类型','交易分类'),direction=cell(row,'收/支','收支'),statusText=cell(row,'当前状态','交易状态','状态');
  const channel=cell(row,'支付方式','收/付款方式','付款方式'),product=cell(row,'商品说明','商品名称','商品');
  const name=cell(row,'交易对方','对方名称')||product||type||'账单记录';
  const order=cell(row,'交易单号','交易订单号','交易号'),refundId=cell(row,'退款单号','退款订单号'),originalOrder=cell(row,'原交易单号','原订单号','原交易订单号');
  const raw=JSON.stringify(Object.fromEntries(headers.map((h,i)=>[h,clean(row[i])])));const blockers:string[]=[];
  let kind='PURCHASE';const compound=compoundChannel(channel),sponsor=/亲情卡|亲属卡/.test(channel);
  // Source event classification is independent of the user's editable accounting interpretation.
  const refundEvent=!!refundId||/^退款(?:-|－|—|\s|$)/.test(product)||/^(退款|商户退款)$/.test(type)||(/退款成功/.test(statusText)&&direction==='收入');
  if(refundEvent)kind='REFUND';
  else if(/花呗.*还款|还款.*花呗|主动还款|自动还款/.test(type+' '+product))kind='REPAYMENT';
  else if(/信用借还|借款|还款/.test(type+' '+product)){kind='UNKNOWN';blockers.push('EVENT');}
  else if(/提现|充值/.test(type)){kind=/提现/.test(type)?'WITHDRAWAL':'INTERNAL_TRANSFER';blockers.push('TRANSFER');}
  else if(/转账|红包|押金/.test(type)){
   kind=direction==='收入'?'UNKNOWN':/红包/.test(type)?'RED_PACKET':/押金/.test(type)?'DEPOSIT':'EXTERNAL_TRANSFER';
   if(direction==='收入')blockers.push('EVENT');
  }else if(direction==='收入')kind='INCOME';
  else if(direction!=='支出'&&!sponsor){kind='UNKNOWN';blockers.push('EVENT');}
  if(sponsor&&kind==='PURCHASE')blockers.push('SPONSOR'); // group confirmation of beneficiary role
  if(compound)blockers.push('COMPOUND');
  if(/退款/.test(statusText)&&!refundEvent)blockers.push('ORIGINAL_REFUNDED');
  if(kind==='REFUND')blockers.push('ORIGINAL');
  const status=/关闭|失败|已撤销/.test(statusText)?'FAILED':/待支付|处理中|未支付|待付款/.test(statusText)?'PENDING':/成功|已支付|已收钱|已收款|已转账|已存入|已退款|部分退款|退款完成|交易完成/.test(statusText)?'SUCCESS':'UNKNOWN';
  if(status==='UNKNOWN')blockers.push('STATUS');
  const date=wallDate(dt);if(!date.utc)blockers.push('DATE');
  let amount=rawAmount;try{amount=(money(rawAmount)/100).toFixed(2);}catch{blockers.push('AMOUNT');}
  if(platform==='未知模板')blockers.push('TEMPLATE');
  // Refunds without their own identifier are weak identities scoped to file+row, never collapsed by original order.
  const sourceClass=refundEvent?'refund':'payment';const eventId=refundEvent?refundId:order;
  const identity=hash(eventId?{v:2,platform,profile,sourceClass,eventId}:{v:2,platform,profile,batch,row:rowIndex});
  const d:Draft={key:identity,identity,itemId:hash({batch,profile,platform,row:rowIndex}),batch,profile,sourceClass,originalOrder,platform,name,amount,date:date.wall,precision:date.precision,kind,status,channel,account:'',to:'',category:'其他',original:'',note:cell(row,'备注')||product,raw,issue:'',selected:false,sourceType:'EXCEL',order:refundId||order,sponsor,consumption:'0',fee:'0',blockers,confirmed:[],workflow:status==='FAILED'?'noeffect':'review',parserVersion:2};
  d.issue=issues(d).join('；');d.selected=status==='SUCCESS'&&!d.issue;out.push(d);
 }
 if(!out.length)throw Error('表格中没有可识别的交易行');if(out.length>3000)throw Error('一次最多导入3000笔，请按月导出');return out;
}
export const issueNames:Record<string,string>={EVENT:'确认交易性质',STATUS:'确认交易状态',DATE:'补充有效日期和时间',AMOUNT:'核对金额及符号',TEMPLATE:'确认来源模板',ORIGINAL:'关联原交易',TRANSFER:'确认转账两端/手续费',SPONSOR:'确认本人是代付受益人',COMPOUND:'组合支付需核对资金分摊',ORIGINAL_REFUNDED:'核对原消费与独立退款',DUPLICATE:'核对相似记录',ACCOUNT:'确认资金账户',TO:'确认转入账户'};
export function issues(d:Draft):string[]{return [...new Set(d.blockers||[])].filter(b=>!(d.confirmed||[]).includes(b)).map(b=>issueNames[b]||b);}
export function parseScreenshot(text:string,fingerprint:string):Draft{
 const originalText=text;
 // Repair spacing only inside known labels, never between arbitrary Chinese words.
 for(const label of ['付款金额','商户全称','交易对方','商品说明','商品名称','收款方','支付方式','付款方式','交易单号','订单号','交易时间','付款时间'])text=text.replace(new RegExp(label.split('').join('[ \\t]*'),'g'),label);
 const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
 const labelValue=(labels:string[])=>{for(let i=0;i<lines.length;i++){const m=lines[i].match(new RegExp('^(?:'+labels.join('|')+')(?:(?:[：:/]|\\s)+|$)(.*)$'));if(m)return m[1].trim()||lines[i+1]||'';}return '';};
 const normalized=text.replace(/\s+/g,' ');
 const amount=normalized.match(/[¥￥]\s*([+-]?\d[\d,]*(?:\.\d{1,2})?)(?![\d.])/)?.[1]||labelValue(['付款金额','实付','金额'])||lines.find(l=>/^[+-]?\d+\.\d{2}$/.test(l))||'';
 const rawDate=normalized.match(/\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2}日?\s+\d{1,2}:\d{2}(?::\d{2})?/)?.[0]||'';
 const date=wallDate(rawDate),platform=/微信/.test(text)?'微信':/支付宝/.test(text)?'支付宝':'截图';
 const order=labelValue(['交易单号','订单号','交易号']).match(/^[\dA-Za-z]{10,}/)?.[0]||'';
 const kind=/退款成功|退款金额/.test(text)?'REFUND':/花呗.*还款|主动还款|自动还款/.test(text)?'REPAYMENT':/转账/.test(text)?'EXTERNAL_TRANSFER':/收入|收款成功/.test(text)?'INCOME':'PURCHASE';
 const name=labelValue(['商户全称','交易对方','收款方'])||labelValue(['商品说明','商品名称','商品'])||'';
 const channel=labelValue(['付款方式','支付方式']);let normalizedAmount=amount;const blockers=['SCREENSHOT'];try{normalizedAmount=(money(amount)/100).toFixed(2);}catch{blockers.push('AMOUNT');}if(!date.utc)blockers.push('DATE');
 if(compoundChannel(channel))blockers.push('COMPOUND');
 return {key:order?hash({v:2,platform,profile:'本人',sourceClass:'payment',eventId:order}):fingerprint,itemId:fingerprint,profile:'本人',platform,name,amount:normalizedAmount,date:date.wall,precision:date.precision,kind,status:/失败|关闭/.test(text)?'FAILED':/待支付|处理中/.test(text)?'PENDING':/成功/.test(text)?'SUCCESS':'UNKNOWN',channel,account:'',to:'',category:'其他',original:'',note:'',raw:JSON.stringify({ocrText:originalText,fingerprint,order}),issue:'请核对截图后保存',selected:false,sourceType:'SCREENSHOT',order,sponsor:/亲情卡|亲属卡/.test(channel),consumption:'0',blockers,confirmed:[],workflow:'review',parserVersion:2};
}
