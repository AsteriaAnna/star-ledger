import {hash} from './store.ts';
export type Draft={key:string;platform:string;name:string;amount:string;date:string;kind:string;status:string;channel:string;account:string;to:string;category:string;original:string;note:string;raw:string;issue:string;selected:boolean;sourceType:'EXCEL'|'SCREENSHOT';order:string;sponsor:boolean;consumption:string};
export function money(value:string):number{const s=value.replace(/[¥￥,\s]/g,'');if(!/^\d+(\.\d{1,2})?$/.test(s))throw Error('金额需要是最多两位小数的正数');const [a,b='']=s.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(n)||n<=0)throw Error('请输入有效金额');return n;}
export function csv(text:string):string[][]{const rows:string[][]=[];let row:string[]=[],v='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){v+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(v);v='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(v);if(row.some(x=>x.trim()))rows.push(row);row=[];v='';}else v+=c;}row.push(v);if(row.some(x=>x.trim()))rows.push(row);return rows;}
const clean=(v:any)=>v instanceof Date?v.toISOString().slice(0,19):String(v??'').replace(/^\uFEFF/,'').trim();
const norm=(s:string)=>s.replace(/[\s（()）]/g,'');
export function parseRows(rows:any[][]):Draft[]{
 const index=rows.findIndex(row=>row.map(clean).some(v=>/交易时间|付款时间/.test(v))&&row.map(clean).some(v=>/金额/.test(v)));
 if(index<0)throw Error('没有找到账单表头。请导入微信/支付宝官方 XLSX 或 CSV 账单。');
 const headers=rows[index].map(v=>norm(clean(v)));const platform=headers.some(v=>v.includes('微信')||v==='交易单号')?'微信':'支付宝';
 const cell=(row:any[],...keys:string[])=>{const n=headers.findIndex(h=>keys.includes(h));return n<0?'':clean(row[n]);};
 const out:Draft[]=[];
 for(const row of rows.slice(index+1)){
  const dt=cell(row,'交易时间','付款时间','交易创建时间');if(!/^\d{4}[-/年]/.test(dt))continue;
  const rawAmount=cell(row,'金额元','金额','交易金额元','交易金额').replace(/[¥￥,\s]/g,'');
  const type=cell(row,'交易类型','交易分类');const direction=cell(row,'收/支','收支','收/付款方式');const statusText=cell(row,'当前状态','交易状态','状态');
  const channel=cell(row,'支付方式','收/付款方式','付款方式');const name=cell(row,'交易对方','对方名称')||cell(row,'商品','商品名称','商品说明')||type||'账单记录';
  const order=cell(row,'交易单号','交易订单号','交易号');const raw=JSON.stringify(Object.fromEntries(headers.map((h,i)=>[h,clean(row[i])])));
  let kind='PURCHASE',issue='';
  if(/退款/.test(type)||/退款成功/.test(statusText)&&direction==='收入')kind='REFUND';
  else if(/提现|充值/.test(type)){kind='INTERNAL_TRANSFER';issue='请确认资金转出、转入账户；提现手续费需另记';}
  else if(/转账|红包|押金/.test(type)){kind=direction==='收入'?'INCOME':'EXTERNAL_TRANSFER';issue=direction==='收入'?'请确认：这是收入、转账退回，还是本人账户间转账？':'请确认转账用途：默认不计消费';}
  else if(direction==='收入')kind='INCOME';
  else if(direction!=='支出'){issue='收支含义不明确，请确认交易类型';}
  if(/退款/.test(statusText)&&kind!=='REFUND')issue='原交易显示退款：请保留原消费，并关联实际退款记录';
  if(kind==='REFUND')issue='请选择原消费，再确认退款金额';
  let status=/关闭|失败|已撤销/.test(statusText)?'FAILED':/待支付|处理中|未支付/.test(statusText)?'PENDING':'SUCCESS';
  if(!statusText)issue=issue||'缺少交易状态，请确认是否成功';
  let date=dt.replace(/[年/]/g,'-').replace('月','-').replace('日','').replace(' ','T').slice(0,19);if(date.length===10)date+='T12:00:00';
  try{money(rawAmount);if(!Number.isFinite(new Date(date).getTime()))throw Error();}catch{issue='金额或时间无效，需要修正';}
  const sponsor=/亲情卡|亲属卡/.test(channel);const key=hash(order?{platform,order,kind}:{platform,raw});
  out.push({key,platform,name,amount:rawAmount,date,kind,status,channel,account:'',to:'',category:'其他',original:'',note:cell(row,'备注')||cell(row,'商品','商品名称','商品说明'),raw,issue,selected:!issue,sourceType:'EXCEL',order,sponsor,consumption:'0'});
 }
 if(!out.length)throw Error('表格中没有可识别的交易行');if(out.length>3000)throw Error('一次最多导入 3000 笔，请按月导出');return out;
}
export function parseScreenshot(text:string,fingerprint:string):Draft{
 const originalText=text;text=text.split('\n').map(line=>line.replace(/(?<=[\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g,'')).join('\n');
 const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);const normalized=text.replace(/\s+/g,' ');
 const amount=normalized.match(/[¥￥]\s*(-?\d[\d,]*\.\d{2})/)?.[1]?.replace('-','')||normalized.match(/(?:付款金额|实付|金额)\s*[:：]?\s*(-?\d[\d,]*\.\d{2})/)?.[1]?.replace('-','')||lines.find(l=>/^[+-]?\d+\.\d{2}$/.test(l))?.replace(/[+-]/,'')||'';
 const date=normalized.match(/\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2}[日]?\s+\d{1,2}:\d{2}(?::\d{2})?/)?.[0]?.replace(/[年/.]/g,'-').replace('月','-').replace('日','').replace(/\s+/,'T')||'';
 const platform=/微信/.test(text)?'微信':/支付宝/.test(text)?'支付宝':'截图';const order=normalized.match(/(?:交易单号|订单号|交易号)\s*[:：]?\s*([\dA-Za-z]{10,})/)?.[1]||'';
 const kind=/退款成功|退款金额/.test(text)?'REFUND':/转账/.test(text)?'EXTERNAL_TRANSFER':/收入|收款成功/.test(text)?'INCOME':'PURCHASE';
 const name=normalized.match(/(?:收款方|商品|商户全称|交易对方)\s*[:：]?\s*([^\s]+)/)?.[1]||lines.find(l=>!/[\d¥￥]|支付|账单|详情|返回|交易|服务|时间/.test(l))||'截图记账';
 const normalizedAmount=amount?Number(amount.replace(/,/g,'')).toFixed(2):'';
 return {key:order?hash({platform,order,kind}):fingerprint,platform,name,amount:normalizedAmount,date,kind,status:/失败|关闭/.test(text)?'FAILED':/待支付|处理中/.test(text)?'PENDING':'SUCCESS',channel:normalized.match(/(?:付款方式|支付方式)\s*[:：]?\s*([^\s]+)/)?.[1]||'',account:'',to:'',category:'其他',original:'',note:'',raw:JSON.stringify({ocrText:originalText,fingerprint,order}),issue:'请核对金额、时间、状态和账户后保存',selected:false,sourceType:'SCREENSHOT',order,sponsor:/亲情卡|亲属卡/.test(text),consumption:'0'};
}
