'use strict';
const CATEGORIES=['餐饮美食','购物消费','交通出行','生活日用','休闲娱乐','学习成长','医疗健康','住房缴费','人情往来','工资收入','其他收入','退款','其他'];
const TYPES={expense:'支出',income:'收入',refund:'退款',neutral:'不计收支'};
const COLORS=['#ada0ef','#7698c6','#79b9b0','#ccad83','#ad84ad','#7383b5'];
const clean=v=>String(v??'').replace(/^\uFEFF/,'').trim().replace(/^['\t]+|\t+$/g,'');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function parseCSV(text){const rows=[];let row=[],s='',q=false;const delimiter=text.split('\n').find(l=>l.includes('交易时间')||l.includes('付款时间'))?.includes('\t')&&!text.includes(',')?'\t':',';for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(q&&text[i+1]==='"'){s+='"';i++;}else if(q||s.trim()==='')q=!q;else s+=c;}else if(c===delimiter&&!q){row.push(s);s='';}else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&text[i+1]==='\n')i++;row.push(s);if(row.some(v=>v.trim()))rows.push(row);row=[];s='';}else s+=c;}if(q)throw Error('CSV 引号不完整，请重新导出原始账单。');row.push(s);if(row.some(v=>v.trim()))rows.push(row);return rows;}
function normalizeDate(value){if(typeof value==='number'){const d=new Date(Math.round((value-25569)*86400000));return d.toISOString().slice(0,19).replace('T',' ');}const v=clean(value).replace(/年|月|\//g,'-').replace('日','').replace('T',' ');const m=v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);if(!m)return null;const parts=[+m[1],+m[2],+m[3],+(m[4]||0),+(m[5]||0),+(m[6]||0)];const [y,mo,d,h,mi,se]=parts;const dt=new Date(y,mo-1,d,h,mi,se);if(y<1990||y>2200||dt.getFullYear()!==y||dt.getMonth()!==mo-1||dt.getDate()!==d||h>23||mi>59||se>59)return null;return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')} ${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}:${String(se).padStart(2,'0')}`;}
function toCents(v){const s=clean(v).replace(/[¥￥,，\s]/g,'').replace(/元$/,'');if(!/^\d+(\.\d{1,2})?$/.test(s))return null;const [a,b='']=s.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));return Number.isSafeInteger(n)&&n>0&&n<=99999999900?n:null;}
function categorize(merchant,note,type,sourceCategory=''){if(type==='refund')return '退款';if(type==='income')return /工资|薪资|薪酬/.test(merchant+note)?'工资收入':'其他收入';const sourceMap={'餐饮美食':'餐饮美食','交通出行':'交通出行','医疗健康':'医疗健康','教育培训':'学习成长','文化休闲':'休闲娱乐','日用百货':'生活日用','服饰装扮':'购物消费','家居家装':'生活日用','运动户外':'休闲娱乐','美容美发':'生活日用','住房缴费':'住房缴费','人情往来':'人情往来','购物消费':'购物消费'};if(sourceMap[sourceCategory])return sourceMap[sourceCategory];const s=merchant+' '+note;const rules=[['餐饮美食',/餐|饭|食堂|咖啡|奶茶|美团|饿了么|面馆|小吃|瑞幸|星巴克|肯德基|麦当劳|饮品|汉堡/],['交通出行',/地铁|公交|打车|滴滴|铁路|车票|出行|停车|加油/],['学习成长',/书店|图书|课程|学费|考试|文具|教育/],['医疗健康',/药|医院|诊所|医疗|体检/],['住房缴费',/房租|水费|电费|燃气|物业|宽带|话费/],['生活日用',/超市|便利店|日用|水果|菜市场/],['休闲娱乐',/电影|游戏|音乐|视频|演出|乐园/],['人情往来',/红包|转账|礼物/],['购物消费',/淘宝|天猫|京东|拼多多|商场|服饰|数码|购物/]];return rules.find(x=>x[1].test(s))?.[0]||'其他';}
function paymentDescriptor(value){
  const raw=clean(value);if(raw==='/')return {raw,parts:[],primary:'',payerType:''};const parts=raw.split(/[&＋+]/).map(clean).filter(Boolean);
  const useful=parts.filter(p=>!/红包|优惠|立减|积分|券|金币|免单|折扣/.test(p));
  const primary=useful.find(p=>/银行卡|储蓄卡|信用卡|尾号|亲情卡|花呗|余额|零钱|现金/.test(p))||useful[0]||parts[0]||'';
  const payerType=/亲情卡/.test(raw)?'family-card':/^花呗(?:$|[（(])/.test(primary)?'huabei-history':'';
  const components=parts.map((label,index)=>({label,index,kind:/红包|优惠|立减|积分|券|金币|免单|折扣/.test(label)?'adjustment':/亲情卡/.test(label)?'external_payer':/^花呗(?:$|[（(])/.test(label)?'liability':/银行卡|储蓄卡|信用卡|尾号|余额|零钱|现金/.test(label)?'account':'unknown'}));
  return {raw,parts,primary,payerType,components};
}
function platformDirection(value){
  const raw=clean(value);
  if(raw==='收入')return {raw,code:'in',kind:'PLATFORM_IN'};
  if(raw==='支出')return {raw,code:'out',kind:'PLATFORM_OUT'};
  if(raw==='不计收支'||raw==='不计收入'||raw==='不计支出')return {raw,code:'neutral',kind:'REPORTING_NEUTRAL'};
  if(raw==='/'||!raw)return {raw,code:'missing',kind:'NOT_APPLICABLE'};
  return {raw,code:'unknown',kind:'UNKNOWN'};
}
function accountEndpoint(label,descriptor){
  const v=clean(label);if(!v)return {label:'',type:'unknown'};
  if(descriptor?.payerType==='family-card'||/亲情卡/.test(v))return {label:v,type:'external_payer'};
  if(/^花呗(?:$|[（(])/.test(v))return {label:v,type:'liability'};
  if(/银行卡|储蓄卡|信用卡|尾号|余额|零钱|现金/.test(v))return {label:v,type:'account'};
  return {label:v,type:'unknown'};
}
function walletEndpoint(source){return {label:source==='微信'?'微信零钱':'支付宝余额',type:'account'};}
function recognizeRow({source,kindText,merchant,note,remark,direction,status,descriptor,amount}){
  const d=platformDirection(direction), text=[kindText,status,note,remark,merchant].map(clean).join(' ');
  const closed=/交易关闭|支付失败|已撤销|未支付|等待付款/.test(status);
  const refundMarker=/退款|已退款|对方已退还|已全额退款/.test(text);
  const refundRow=refundMarker&&(/退款/.test(kindText)||d.code!=='out');
  const partialRefund=refundMarker&&d.code==='out'&&!/退款/.test(kindText);
  const repayment=/花呗/.test(text)&&/还款|还清/.test(text);
  const topup=/零钱充值|充值/.test(kindText)&&!/话费|会员/.test(kindText);
  const withdrawal=/零钱提现|提现/.test(kindText);
  const transfer=/转账|收款|转入|转出/.test(kindText);
  let baseEventType='unclassified';
  if(refundRow)baseEventType='refund';
  else if(repayment)baseEventType='liability_repayment';
  else if(topup||withdrawal)baseEventType='internal_transfer';
  else if(transfer)baseEventType='transfer';
  else if(d.code==='out')baseEventType='expense';
  else if(d.code==='in')baseEventType='income';
  else if(descriptor.payerType==='family-card'&&d.code==='neutral')baseEventType='expense';
  else if(d.code==='neutral')baseEventType='neutral';
  const eventType=closed?'closed':baseEventType;
  const transferReturned=baseEventType==='transfer'&&d.code==='out'&&/对方已退还|已退回|全额退还/.test(text);
  const amountMatch=status.match(/(?:已退款|退款成功|部分退款)[（(￥¥\s]*(\d+(?:\.\d{1,2})?)/);
  const statusRefundAmount=amountMatch?Math.min(amount,toCents(amountMatch[1])||0):(/已全额退款|全额退款成功|对方已退还|全额退还/.test(text)?amount:0);
  const orderStatus=closed?'closed':transferReturned?'returned':/等待确认收货/.test(status)?'waiting_receipt':refundRow?(/全额|全部/.test(text)?'refunded':'refund_posted'):/还款成功/.test(status)?'repayment_completed':/充值完成/.test(status)?'topup_completed':/提现已到账/.test(status)?'withdrawal_completed':/支付成功|交易成功|已存入零钱|对方已收钱/.test(status)?'completed':'unknown';
  const postingStatus=closed?'not_posted':refundRow?'reversal_posted':orderStatus==='unknown'?'unknown':'posted';
  const flow={fromLabel:'',fromType:'unknown',toLabel:'',toType:'unknown',relationRequired:false};
  const wallet=walletEndpoint(source);
  const paidRaw=accountEndpoint(descriptor.primary,descriptor);
  const paid=/^(零钱|余额)$/.test(paidRaw.label)?wallet:paidRaw;
  if(eventType==='internal_transfer'){
    if(withdrawal){flow.fromLabel=wallet.label;flow.fromType='account';flow.toLabel=paid.label;flow.toType=paid.type;}
    else {flow.fromLabel=paid.label;flow.fromType=paid.type;flow.toLabel=wallet.label;flow.toType='account';}
  }else if(eventType==='liability_repayment'){
    flow.fromLabel=paid.label;flow.fromType=paid.type;flow.toLabel=clean(merchant)||'花呗';flow.toType='liability';
  }else if(baseEventType==='expense'){
    flow.fromLabel=paid.label;flow.fromType=paid.type;flow.toLabel=clean(merchant);flow.toType='external';
  }else if(baseEventType==='transfer'){
    if(d.code==='in'){flow.fromLabel=clean(merchant);flow.fromType='external';flow.toLabel=wallet.label;flow.toType='account';}
    else {flow.fromLabel=paid.label;flow.fromType=paid.type;flow.toLabel=clean(merchant);flow.toType='external';}
  }else if(eventType==='income'){
    flow.fromLabel=clean(merchant);flow.fromType='external';flow.toLabel=wallet.label;flow.toType='account';
  }else if(eventType==='refund'){
    flow.fromLabel=clean(merchant);flow.fromType='external';flow.toLabel=paid.label;flow.toType=paid.type;flow.relationRequired=true;
  }else if(eventType==='closed'&&['expense','transfer'].includes(baseEventType)){
    if(baseEventType==='transfer'&&d.code==='in'){flow.fromLabel=clean(merchant);flow.fromType='external';flow.toLabel=wallet.label;flow.toType='account';}
    else {flow.fromLabel=paid.label;flow.fromType=paid.type;flow.toLabel=clean(merchant);flow.toType='external';}
  }
  const review=[];
  if(eventType==='unclassified')review.push({type:'UNCLASSIFIED_EVENT',blocking:false});
  if(eventType==='expense'&&descriptor.payerType!=='family-card'&&!flow.fromLabel)review.push({type:'MISSING_PAYMENT_CHANNEL',blocking:false});
  if(eventType==='refund')review.push({type:'REFUND_RELATION',blocking:false});
  return {platformDirection:d,eventType,baseEventType,orderStatus,postingStatus,reversalStatus:transferReturned?'returned':partialRefund?'partial_refund':refundRow?(orderStatus==='refunded'?'full_refund':'refund_posted'):null,statusRefundAmount,flow,review,symbols:{direction:d.kind,slash:direction==='/'?'column_placeholder':null,closed,refund:refundMarker,refundRow,partialRefund,repayment,topup,withdrawal,transfer,transferReturned},version:4};
}
function importRows(rows,filename){
  const normalize=s=>clean(s).replace(/\s/g,'').replace(/（/g,'(').replace(/）/g,')');
  let headerIndex=-1,h=[];
  for(let i=0;i<Math.min(rows.length,150);i++){
    const r=rows[i].map(normalize);
    if(r.some(x=>['交易时间','付款时间','交易创建时间'].includes(x))&&r.some(x=>/^金额(?:\(元\))?$/.test(x))&&r.some(x=>['收/支','收支','收支类型'].includes(x))){headerIndex=i;h=r;break;}
  }
  if(headerIndex<0)throw Error('没有识别到标准账单表头。请使用微信 / 支付宝原始导出的 CSV 或 XLSX（需有交易时间、收/支、金额列）。');
  const idx=(...a)=>h.findIndex(x=>a.includes(x));
  const payment=idx('支付方式','收/付款方式','收付款方式'),originalOrder=idx('原交易单号','原订单号','原交易订单号');
  const date=idx('交易时间','付款时间','交易创建时间'),money=idx('金额(元)','金额'),direction=idx('收/支','收支','收支类型'),merchant=idx('交易对方','商户名称'),note=idx('商品','商品名称','商品说明'),status=idx('当前状态','交易状态'),id=idx('交易单号','交易订单号','支付宝交易号'),merchantOrder=idx('商户单号','商家订单号'),kind=idx('交易类型','交易分类'),remark=idx('备注');
  const source=h.includes('交易对方账号')||h.includes('收/付款方式')||h.includes('收付款方式')?'支付宝':h.includes('当前状态')||h.includes('支付方式')?'微信':/支付宝/.test(rows.slice(0,headerIndex).flat().join('')+filename)?'支付宝':/微信/.test(rows.slice(0,headerIndex).flat().join('')+filename)?'微信':null;
  if(!source)throw Error('无法确定账单来源，请保留原始表头或将文件名标注为“微信”或“支付宝”。');
  let rejected=0,ignored=0;const errors=[],records=[];
  rows.slice(headerIndex+1).forEach((r,i)=>{
    if(!r.some(v=>clean(v)))return;
    const rawDate=r[date];
    if(/^[-=]|共\d|统计|说明|温馨|导出/.test(clean(r[0]))&&!/^\d{4}[-/年]/.test(clean(rawDate))){ignored++;return;}
    const d=normalizeDate(rawDate),amount=toCents(r[money]),dir=clean(r[direction]),st=clean(r[status]);
    const validDir=['支出','收入','/','不计收支','不计收入','不计支出','其他',''].includes(dir);
    if(!d||!amount||!validDir){rejected++;if(errors.length<6)errors.push(`第 ${headerIndex+i+2} 行：${!d?'交易时间':!amount?'金额':'收支方向'}无法识别`);return;}
    if(/支付失败|已撤销|未支付|等待付款/.test(st)){ignored++;return;}
    let type=dir==='支出'?'expense':dir==='收入'?'income':'neutral';
    if(/交易关闭/.test(st))type='neutral';
    const kindText=clean(r[kind]),n=clean(r[note]),rem=clean(r[remark]),mer=clean(r[merchant])||'未知商户';
    if(/退款/.test(kindText+' '+st+' '+n+' '+rem)&&type!=='expense')type='refund';
    const descriptor=paymentDescriptor(r[payment]);
    const historicRepayment=/花呗/.test(kindText+' '+n+' '+rem+' '+mer)&&/还款|还清/.test(kindText+' '+n+' '+rem+' '+mer);
    if(historicRepayment)type='neutral';
    if(descriptor.payerType==='family-card'&&type==='neutral'&&!/退款|交易关闭|已撤销|失败/.test(kindText+' '+st+' '+n+' '+rem))type='expense';
    const payerType=historicRepayment?'huabei-repayment-history':descriptor.payerType;
    const directionHint=dir==='/'&&/转账|提现|充值|转入|转出|收款/.test(kindText+' '+n+' '+rem+' '+mer);
    const feeMatch=(n+' '+rem).match(/(?:服务费|手续费)\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/),fee=feeMatch?toCents(feeMatch[1]):0;
    const orderId=clean(r[id]),merchantOrderId=clean(r[merchantOrder]),fingerprint=[d,amount,mer,n,kindText].join('|');
    const stable=source+'|'+(orderId&&orderId!=='/'&&orderId!=='-'?'order:'+orderId:'row:'+fingerprint);
    const recognition=recognizeRow({source,kindText,merchant:mer,note:n,remark:rem,direction:dir,status:st,descriptor,amount});
    records.push({id:stable,source,orderId,merchantOrderId,date:d,amount,type,merchant:mer,note:[n,rem&&rem!=='/'?rem:''].filter(Boolean).join(' · '),category:categorize(mer,n+' '+kindText,type,kindText),status:st,payment:descriptor.raw,paymentKey:descriptor.primary,paymentParts:descriptor.parts,originalOrder:clean(r[originalOrder]),payerType,fee,recognition,raw:{kind:kindText,sourceCategory:kindText,direction:dir,directionHint,unclassifiedDirection:dir==='/'&&!directionHint,classificationVersion:4,symbols:recognition.symbols,columns:Object.fromEntries(h.map((k,j)=>[k,clean(r[j])])),merchantOrderId}});
  });
  return {source,records,rejected,ignored,errors};
}
async function readXLSX(buffer){const bytes=new Uint8Array(buffer),dv=new DataView(buffer);let end=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(dv.getUint32(p,true)===0x06054b50){end=p;break;}if(end<0)throw Error('XLSX 文件不完整或已加密，请重新导出。');const count=dv.getUint16(end+10,true);let pos=dv.getUint32(end+16,true),total=0;const entries=new Map();for(let n=0;n<count;n++){if(pos+46>bytes.length||dv.getUint32(pos,true)!==0x02014b50)throw Error('XLSX 目录无效。');const flags=dv.getUint16(pos+8,true),method=dv.getUint16(pos+10,true),size=dv.getUint32(pos+20,true),expanded=dv.getUint32(pos+24,true),nl=dv.getUint16(pos+28,true),el=dv.getUint16(pos+30,true),cl=dv.getUint16(pos+32,true),offset=dv.getUint32(pos+42,true);const name=new TextDecoder().decode(bytes.slice(pos+46,pos+46+nl));total+=expanded;if(total>100*1024*1024||count>3000)throw Error('表格解压后过大，请分月导出。');if(flags&1)throw Error('不支持加密表格，请先解密。');entries.set(name,{method,size,expanded,offset});pos+=46+nl+el+cl;}async function file(name){const e=entries.get(name);if(!e)return '';const p=e.offset;if(p+30>bytes.length||dv.getUint32(p,true)!==0x04034b50)throw Error('XLSX 数据损坏。');const start=p+30+dv.getUint16(p+26,true)+dv.getUint16(p+28,true);if(start+e.size>bytes.length)throw Error('XLSX 数据不完整。');let content=bytes.slice(start,start+e.size);if(e.method===8){if(typeof DecompressionStream==='undefined')throw Error('此浏览器无法读取 XLSX，请使用新版 Edge / Chrome，或改用 CSV。');const reader=new Blob([content]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>e.expanded||size>100*1024*1024){await reader.cancel();throw Error('XLSX 解压大小异常。');}chunks.push(value);}content=new Uint8Array(size);let p=0;for(const c of chunks){content.set(c,p);p+=c.length;}}else if(e.method!==0)throw Error('不支持此表格压缩格式，请改用 CSV。');return new TextDecoder().decode(content);}const xml=t=>{const d=new DOMParser().parseFromString(t,'application/xml');if(d.querySelector('parsererror'))throw Error('表格 XML 损坏。');return d;};const ss=await file('xl/sharedStrings.xml');const strings=ss?Array.from(xml(ss).getElementsByTagName('si'),s=>Array.from(s.getElementsByTagName('t'),t=>t.textContent).join('')):[];const book=xml(await file('xl/workbook.xml'));const rels=xml(await file('xl/_rels/workbook.xml.rels'));const relation=new Map(Array.from(rels.getElementsByTagName('Relationship'),r=>[r.getAttribute('Id'),r.getAttribute('Target')]));const outputs=[];for(const sh of Array.from(book.getElementsByTagName('sheet'))){let target=relation.get(sh.getAttribute('r:id'));if(!target)continue;target=target.startsWith('/')?target.slice(1):'xl/'+target;target=target.replace(/\/\.\//g,'/');const raw=await file(target);if(!raw)continue;const rows=[];for(const row of Array.from(xml(raw).getElementsByTagName('row'))){const arr=[];for(const c of Array.from(row.getElementsByTagName('c'))){const ref=c.getAttribute('r')||'A1';const letters=ref.match(/^[A-Z]+/)?.[0]||'A';let ci=0;for(const l of letters)ci=ci*26+l.charCodeAt(0)-64;if(ci>200)continue;const v=c.getElementsByTagName('v')[0]?.textContent||'';const type=c.getAttribute('t');arr[ci-1]=type==='s'?(strings[Number(v)]??''):type==='inlineStr'?Array.from(c.getElementsByTagName('t'),t=>t.textContent).join(''):type==='str'?v:v!==''&&Number.isFinite(Number(v))?Number(v):v;}rows.push(Array.from({length:arr.length},(_,i)=>arr[i]??''));}outputs.push(rows);}return outputs;}
function validateRecord(r){if(!r||typeof r!=='object'||!TYPES[r.type]||!['微信','支付宝','手动'].includes(r.source)||typeof r.id!=='string'||!r.id||r.id.length>3000||!normalizeDate(r.date)||!Number.isSafeInteger(r.amount)||r.amount<=0||r.amount>99999999900||!CATEGORIES.includes(r.category)||typeof r.merchant!=='string'||r.merchant.length>2000||typeof r.note!=='string'||r.note.length>10000)throw Error('备份中的账单格式不正确，未写入任何数据。');return {id:r.id,source:r.source,date:normalizeDate(r.date),amount:r.amount,type:r.type,merchant:r.merchant,note:r.note,category:r.category,orderId:clean(r.orderId).slice(0,500),status:clean(r.status).slice(0,200)};}
