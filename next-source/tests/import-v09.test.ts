import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRows,type Draft} from '../apps/web/src/importer.ts';
import {accountSetupGroups,resolveAccount,aliasId} from '../apps/web/src/account-matcher.ts';
import {configureImportAccounts} from '../apps/web/src/import-accounts.ts';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';
import {reviewDraft,sourcePayload,safeCandidates} from '../apps/web/src/import-workflow.ts';
import {refundContext,resolveRefund} from '../apps/web/src/refund-matcher.ts';
import {linkAvailableRefunds} from '../apps/web/src/import-refunds.ts';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import {consumptionInPeriod,accountBalance} from '../packages/analytics/index.ts';
import {project} from '../packages/sync/projection.ts';
const h=['交易时间','交易分类','交易对方','商品说明','收/支','金额','收/付款方式','交易状态','交易订单号'];
const row=(channel='农业银行储蓄卡(2372)',order='order1',product='午餐',type='餐饮美食',direction='支出',amount='44.50',status='交易成功',date='2026-09-20 12:00:00')=>[date,type,'商户',product,direction,amount,channel,status,order];
const parse=(rows:string[][])=>parseRows([h,...rows]);
const snapshot=(s:MemoryStore)=>project(s.state.ops);
const setup=(ds:Draft[])=>{const s=new MemoryStore({...fresh(),imports:ds});const g=accountSetupGroups(ds,[],[],[]);s.atomic(()=>configureImportAccounts(s,g.map(g=>({key:g.key,accountId:'new',name:g.descriptor?.name||g.label,type:g.descriptor?.type||'ASSET'})),0));return s;};
const svc=(s:MemoryStore)=>new BusinessAccountingService(s,s.state.device);
const period=['2026-09-01T00:00:00Z','2026-10-01T00:00:00Z'] as const;
const source=(d:Draft)=>({id:d.key+'-source',sourceType:'EXCEL' as const,platform:d.platform,rawPayload:JSON.stringify(sourcePayload(d))});

test('first import groups known channels, excludes sponsor/failed; names and balances are independent',()=>{
 const ds=parse([row(),row('农业银行储蓄卡(2372)&红包','o2'),row('花呗','o3'),row('亲情卡(家人)&闪购红包','o4','午餐','餐饮美食','不计收支'),row('','o5','花呗自动还款','信用借还','不计收支','12','还款失败')]);
 assert.equal(accountSetupGroups(ds,[],[],[]).length,2);
 const s=setup(ds);assert.equal(s.entities.filter(e=>e.type==='accounts').length,2);
 assert.ok(s.entities.filter(e=>e.type==='accounts').every(a=>a.fields.balance_state==='UNINITIALIZED'));
 assert.equal(s.state.imports?.[0].account,s.state.imports?.[1].account);
 assert.equal(s.state.imports?.[3].issue,'');assert.equal(s.state.imports?.[3].account,'');
 assert.equal(s.state.imports?.[4].workflow,'noeffect');
 const bank=s.state.imports![0].account;
 new AccountingService(s,s.state.device).execute([{action:'PATCH_FIELD',entity:{type:'accounts',id:bank,fields:{name:'生活费用'}}}]);
 const incoming=parse([row('农业银行储蓄卡(2372)','o6')])[0];
 assert.equal(reviewDraft(incoming,s.entities,[]).account,bank);
 const refund=parse([row('农业银行储蓄卡(2372)','o7','退款-午餐','餐饮美食','不计收支','5','退款成功')])[0];
 assert.equal(reviewDraft(refund,s.entities,[]).account,bank);
});
test('one account creation handles the same bank across WeChat and Alipay',()=>{
 const a=parse([row()])[0],w={...a,key:'wx',itemId:'wx',platform:'微信'};
 const s=setup([a,w]);assert.equal(s.entities.filter(e=>e.type==='accounts').length,1);assert.equal(s.state.imports![0].account,s.state.imports![1].account);
});
test('existing account binding and rename is atomic and does not modify source evidence',()=>{
 const d=parse([row()])[0],s=new MemoryStore({...fresh(),imports:[d]});
 svc(s).execute({kind:'CREATE_ACCOUNT',id:'bank',name:'日常账户',accountType:'ASSET',openingBalance:null,openingBalanceAt:'2026-09-01T00:00:00Z'});
 const g=accountSetupGroups([d],s.entities,[],[])[0];
 s.atomic(()=>configureImportAccounts(s,[{key:g.key,accountId:'bank',name:'我的农行卡',type:'ASSET'}],0));
 assert.equal(s.entities.filter(e=>e.type==='accounts').length,1);assert.equal(s.get('accounts','bank')!.fields.name,'我的农行卡');assert.equal(s.state.imports![0].raw,d.raw);
});
test('confirmed, deferred and ignored rows are not remapped by first-import setup',()=>{
 const ds=parse([row(),row('花呗','o2'),row('余额','o3')]);ds[1].workflow='ignored';ds[2].workflow='deferred';
 const s=setup(ds);assert.equal(s.state.imports![1].account,'');assert.equal(s.state.imports![2].account,'');assert.equal(s.entities.filter(e=>e.type==='accounts').length,1);
});
test('family card, repayment, categories and promotional tokens use source facts',()=>{
 const ds=parse([row('亲情卡(妈妈)&红包','o1','药品','医疗健康','不计收支'),row('农业银行储蓄卡(2372)&闪购红包','o2'),row('农业银行储蓄卡(2372)','o3','花呗自动还款','信用借还','不计收支')]);
 assert.equal(ds[0].kind,'PURCHASE');assert.equal(ds[0].sponsor,true);assert.equal(ds[0].category,'医疗');assert.deepEqual(ds[0].blockers,[]);assert.deepEqual(ds[1].blockers,[]);assert.equal(ds[2].kind,'REPAYMENT');
 const s=setup(ds);assert.equal(s.get('accounts',s.state.imports![2].to)!.fields.type,'LIABILITY');
 svc(s).execute({kind:'PURCHASE',id:'sponsor',name:'药品',amount:1000,payer:null,funding:'EXTERNAL_SPONSOR',categoryId:'医疗',occurredAt:'2026-09-20T04:00:00Z'});
 assert.equal(s.entities.filter(e=>e.type==='balance_movements').length,0);assert.equal(consumptionInPeriod(snapshot(s),...period),1000);
});
test('separate refunds have stable source identity across overlapping files and classify merchant suffixes',()=>{
 const a=parse([row('余额','paid1*REFUND_1','退款-午餐','餐饮美食','不计收支','1','退款成功')])[0];
 const b=parse([row(),row('余额','paid1*REFUND_1','退款-午餐','餐饮美食','不计收支','1','退款成功')])[1];assert.equal(a.identity,b.identity);
 const wh=['交易时间','交易类型','交易对方','商品','收/支','金额(元)','支付方式','当前状态','交易单号'];
 const ds=parseRows([wh,['2026-09-20 12:00:00','盒马-退款','盒马','退款','收入','0.44','/','退款成功','refund'],['2026-09-20 12:00:00','转账','小王','转账','收入','10','/','已收钱','incoming']]);
 assert.equal(ds[0].kind,'REFUND');assert.equal(ds[1].kind,'TRANSFER_IN');assert.equal(reviewDraft(ds[1],[],[]).issue,'');
});
test('all verified Alipay order suffix formats link partial refunds by exact prefix',()=>{
 const original=parse([row('余额','paid1')])[0];const context=refundContext([], [original]);
 for(const order of ['paid1*REFUND_1','paid1*123','paid1_123']){
  const d=parse([row('余额',order,'退款-午餐','餐饮美食','不计收支','0.44','退款成功','2026-09-21 12:00:00')])[0];assert.equal(resolveRefund(d,context).id,'import-'+original.identity);
 }
 const other=parse([row('余额','other_123','退款-午餐','餐饮美食','不计收支','0.44','退款成功','2026-09-21 12:00:00')])[0];assert.equal(resolveRefund(other,context).id,'');
});
test('WeChat unique full refund matches; partial and multiple equal purchases stay independently bookable',()=>{
 const original={...parse([row('零钱')])[0],platform:'微信'},refund={...original,key:'refund',kind:'REFUND',order:'refund',date:'2026-09-21T12:00:00'};
 assert.ok(resolveRefund(refund,refundContext([], [original])).id);
 assert.equal(resolveRefund({...refund,amount:'0.44'},refundContext([], [original])).id,'');
 assert.equal(resolveRefund(refund,refundContext([], [original,{...original,key:'another',identity:'another'}])).id,'');
 const unbound=reviewDraft({...refund,channel:'/',amount:'0.44'},[],[]);assert.equal(unbound.issue,'');
});
test('standalone refund posts once, later links category without changing cash or total consumption',()=>{
 const s=new MemoryStore(fresh()),service=svc(s);service.execute({kind:'CREATE_ACCOUNT',id:'a',name:'卡',accountType:'ASSET',openingBalance:10000,openingBalanceAt:'2026-09-01T00:00:00Z'});
 service.execute({kind:'PURCHASE',id:'p',name:'餐厅',amount:4450,payer:'a',categoryId:'餐饮',occurredAt:'2026-09-20T04:00:00Z'});
 service.execute({kind:'REFUND',id:'r',name:'退款',amount:44,originalId:null,destination:'a',occurredAt:'2026-09-21T04:00:00Z'});
 const before=accountBalance(snapshot(s),'a','2026-09-30T00:00:00Z').balance;
 assert.equal(consumptionInPeriod(snapshot(s),...period),4406);
 service.execute({kind:'LINK_RETURN',transactionId:'r',originalId:'p'});
 assert.equal(accountBalance(snapshot(s),'a','2026-09-30T00:00:00Z').balance,before);assert.equal(s.get('consumption_effects','r:effect')!.fields.category_id,'餐饮');
 const count=s.state.ops.length;service.execute({kind:'LINK_RETURN',transactionId:'r',originalId:'p'});assert.equal(s.state.ops.length,count);
 service.execute({kind:'REFUND',id:'tooMuch',name:'退款',amount:4450,originalId:null,destination:'a',occurredAt:'2026-09-22T04:00:00Z'});
 assert.throws(()=>service.execute({kind:'LINK_RETURN',transactionId:'tooMuch',originalId:'p'}),/RETURN_EXCEEDS_ORIGINAL/);
});
test('sponsored independent refund and transfer receipt preserve accounting meaning',()=>{
 const s=new MemoryStore(fresh()),service=svc(s);
 service.execute({kind:'REFUND',id:'r',name:'亲情卡退款',amount:100,originalId:null,destination:null,funding:'EXTERNAL_SPONSOR',occurredAt:'2026-09-21T04:00:00Z'});
 assert.equal(s.entities.filter(e=>e.type==='balance_movements').length,0);assert.equal(consumptionInPeriod(snapshot(s),...period),-100);
 service.execute({kind:'TRANSFER_IN',id:'in',name:'收到转账',amount:1000,destination:null,occurredAt:'2026-09-21T04:00:00Z'});
 assert.equal(s.get('transactions','in')!.fields.event_type,'TRANSFER_IN');assert.equal(s.get('balance_movements','in:movement:0')!.fields.amount,1000);assert.equal(consumptionInPeriod(snapshot(s),...period),-100);
});
test('later original import automatically links an earlier independently imported refund',()=>{
 const original=parse([row('余额','paid1')])[0],r=parse([row('余额','paid1*REFUND_1','退款-午餐','餐饮美食','不计收支','5','退款成功','2026-09-21 12:00:00')])[0];
 const s=new MemoryStore(fresh()),service=svc(s);
 service.execute({kind:'REFUND',id:'r',name:r.name,amount:500,originalId:null,destination:null,occurredAt:'2026-09-21T04:00:00Z',source:source(r)});assert.equal(linkAvailableRefunds(s),0);
 service.execute({kind:'PURCHASE',id:'p',name:original.name,amount:4450,payer:null,categoryId:'餐饮',occurredAt:'2026-09-20T04:00:00Z',source:source(original)});
 assert.equal(linkAvailableRefunds(s),1);assert.equal(linkAvailableRefunds(s),0);assert.equal(s.entities.filter(e=>e.type==='balance_movements'&&e.fields.transaction_id==='r').length,1);
});
test('different official order IDs avoid false duplicate prompts and old sponsor blocker upgrades',()=>{
 const d=parse([row()])[0],s=new MemoryStore(fresh());svc(s).execute({kind:'PURCHASE',id:'p',name:d.name,amount:4450,payer:null,occurredAt:'2026-09-20T04:00:00Z',source:source(d)});
 assert.equal(safeCandidates(parse([row('余额','other')])[0],s.entities).length,0);
 const old={...parse([row('亲情卡(妈妈)','s')])[0],parserVersion:2,blockers:['SPONSOR','ORIGINAL_REFUNDED']};assert.equal(reviewDraft(old,[],[]).issue,'');
});

test('explicit import correction changes event/accounts atomically, preserves raw evidence and rejects stale review',async()=>{
 const {correctionSnapshot}=await import('../packages/accounting/business.ts');
 const s=new MemoryStore(fresh()),service=svc(s);for(const [id,type]of [['a','ASSET'],['h','LIABILITY']] as const)service.execute({kind:'CREATE_ACCOUNT',id,name:id,accountType:type,openingBalance:10000,openingBalanceAt:'2026-09-01T00:00:00Z'});
 const d=parse([row('农业银行储蓄卡(2372)','repay','花呗自动还款','信用借还','不计收支','30')])[0];
 service.execute({kind:'PURCHASE',id:'p',name:'原名称',note:'原备注',amount:3000,payer:'a',categoryId:'其他',occurredAt:'2026-09-20T04:00:00Z',source:source(d)});
 const expectedSnapshot=correctionSnapshot(s.entities,'p'),replacement={kind:'REPAYMENT' as const,id:'p',name:'识别名称',amount:3000,from:'a',to:'h',occurredAt:'2026-09-20T04:00:00Z'};
 const correction={kind:'CORRECT_IMPORTED_EVENT' as const,transactionId:'p',replacement,expectedSnapshot,sourceId:'correction',correctedAt:'2026-09-30T00:00:00Z'};
 service.execute(correction);
 assert.equal(s.get('transactions','p')!.fields.event_type,'REPAYMENT');assert.equal(s.get('transactions','p')!.fields.display_name,'原名称');assert.equal(s.get('transactions','p')!.fields.note,'原备注');
 assert.equal(consumptionInPeriod(snapshot(s),...period),0);assert.equal(accountBalance(snapshot(s),'a','2026-09-30T00:00:00Z').balance,7000);assert.equal(accountBalance(snapshot(s),'h','2026-09-30T00:00:00Z').balance,7000);
 assert.equal(s.get('source_records',d.key+'-source')!.fields.raw_payload,source(d).rawPayload);
 const count=s.state.ops.length;assert.throws(()=>service.execute(correction),/STALE_TRANSACTION/);assert.equal(s.state.ops.length,count);assert.equal(snapshot(s).conflicts.length,0);
});

test('consumer export statuses preserve paid orders and distinguish merchant recharge from wallet transfers',()=>{
 const ds=parse([row('亲情卡(家人)&闪购支付红包','new','账户充值','充值缴费','不计收支','10','交易成功'),row('余额','pending-delivery','商品','日用百货','支出','10','等待确认收货')]);
 assert.equal(ds[0].kind,'PURCHASE');assert.equal(ds[0].sponsor,true);assert.deepEqual(ds[0].blockers,[]);assert.equal(ds[1].status,'SUCCESS');
});
test('closed Alipay orders with successful exact refunds retain both accounting sides',()=>{
 const ds=parse([row('余额','closed','商品','购物','支出','10','交易关闭'),row('余额','closed*REFUND_1','退款-商品','购物','不计收支','10','退款成功','2026-09-21 12:00:00'),row('余额','unpaid','商品','购物','支出','10','交易关闭')]);
 assert.equal(ds[0].status,'SUCCESS');assert.equal(ds[2].status,'FAILED');assert.ok(resolveRefund(ds[1],refundContext([],ds)).id);
});
test('WeChat wallet transfers resolve both endpoints and subtract explicit fees from exported withdrawal total',()=>{
 const h=['交易时间','交易类型','交易对方','商品','收/支','金额(元)','支付方式','当前状态','交易单号','备注'];
 const ds=parseRows([h,['2026-09-20 12:00:00','零钱充值','银行','/','/','200','农业银行储蓄卡(1234)','充值完成','charge','/'],['2026-09-21 12:00:00','零钱提现','银行','/','/','100.10','农业银行储蓄卡(1234)','提现已到账','withdraw','服务费¥0.10']]);
 const s=setup(ds),drafts=s.state.imports!;assert.equal(s.entities.filter(e=>e.type==='accounts').length,2);assert.ok(drafts.every(d=>d.status==='SUCCESS'&&!d.issue));assert.equal(drafts[1].amount,'100.00');assert.equal(drafts[1].fee,'0.10');assert.equal(drafts[0].account,drafts[1].to);assert.equal(drafts[0].to,drafts[1].account);
});
test('WeChat returned transfer with missing counterparty uses unique full amount and original transfer remark',()=>{
 const h=['交易时间','交易类型','交易对方','商品','收/支','金额(元)','支付方式','当前状态','交易单号','备注'];
 const ds=parseRows([h,['2026-09-20 12:00:00','转账','朋友','转账备注:订金','支出','10','零钱','对方已退还','pay','/'],['2026-09-21 12:00:00','转账-退款','/','转账备注:订金','收入','10','零钱','已全额退款','return','/']]);
 assert.ok(ds.every(d=>d.status==='SUCCESS'));assert.equal(ds[1].name,'转账备注:订金');assert.ok(resolveRefund(ds[1],refundContext([],ds)).id);
 const ambiguous=[...ds,{...ds[0],identity:'second',key:'second'}];assert.equal(resolveRefund(ds[1],refundContext([],ambiguous)).id,'');
});

test('linear import history optimization matches causal projection with unordered operations',()=>{
 const s=new MemoryStore(fresh()),service=svc(s);service.execute({kind:'CREATE_ACCOUNT',id:'a',name:'卡',accountType:'ASSET',openingBalance:null,openingBalanceAt:'2026-09-01T00:00:00Z'});
 for(let i=0;i<20;i++)service.execute({kind:'PURCHASE',id:'p'+i,name:'消费',amount:100+i,payer:'a',categoryId:'其他',occurredAt:'2026-09-20T04:00:00Z'});
 service.execute({kind:'DELETE_TRANSACTION',transactionId:'p0',deletedAt:'2026-09-21T00:00:00Z'});
 const stable=(p:ReturnType<typeof project>)=>({entities:p.entities.sort((a,b)=>(a.type+a.id).localeCompare(b.type+b.id)),conflicts:p.conflicts.sort((a,b)=>a.id.localeCompare(b.id)),versions:p.versions.sort((a,b)=>(a.type+a.id+a.field).localeCompare(b.type+b.id+b.field))});
 assert.deepEqual(stable(project(s.state.ops)),stable(project([...s.state.ops].reverse())));
});

test('WeChat received transfer explicitly deposited into wallet resolves the missing payment channel',()=>{
 const h=['交易时间','交易类型','交易对方','商品','收/支','金额(元)','支付方式','当前状态','交易单号'];
 const ds=parseRows([h,['2026-09-20 12:00:00','转账','朋友','转账','收入','10','/','已存入零钱','received']]);const s=setup(ds),d=s.state.imports![0];assert.equal(d.kind,'TRANSFER_IN');assert.ok(d.account);assert.equal(d.issue,'');assert.equal(s.get('accounts',d.account)!.fields.name,'微信零钱');assert.equal(d.channel,'/');
});
