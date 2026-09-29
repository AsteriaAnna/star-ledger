import {test} from 'node:test';
import assert from 'node:assert/strict';
import {csv,parseRows,parseScreenshot,money} from '../apps/web/src/importer.ts';
const headers=['交易时间','交易类型','交易对方','商品','收/支','金额(元)','支付方式','当前状态','交易单号'];
test('official rows preserve refunds, sponsors, pending status and internal transfer review',()=>{
 const rows=parseRows([headers,['2026-09-20 12:00:00','商户消费','商户','产品','支出','44.00','亲情卡','支付成功','id1'],['2026-09-21 12:00:00','退款','商户','退款','收入','12.00','银行卡','退款成功','id2'],['2026-09-22 12:00:00','充值','微信','充值','/','100.00','银行卡','支付成功','id3'],['2026-09-22 12:00:00','商户消费','商户','待支付','支出','20.00','银行卡','待支付','id4']]);
 assert.equal(rows[0].sponsor,true);assert.equal(rows[1].kind,'REFUND');assert.equal(rows[1].selected,false);assert.equal(rows[2].kind,'INTERNAL_TRANSFER');assert.equal(rows[2].selected,false);assert.equal(rows[3].status,'PENDING');
});
test('CSV handles BOM, quoted commas and embedded newlines',()=>{const rows=csv('\uFEFF交易时间,金额(元),交易对方\r\n2026-09-20 12:00:00,44.00,"商户,\n分店"');assert.equal(rows[1][2],'商户,\n分店');});
test('money is integer cents and invalid amounts fail',()=>{assert.equal(money('￥1,234.50'),123450);assert.throws(()=>money('1.005'));assert.throws(()=>money('-44'));});
test('screenshot parser does not substitute current date when recognition misses it',()=>{const d=parseScreenshot('微信支付\n收款方 测试商户\n￥44.00\n支付成功','hash');assert.equal(d.amount,'44.00');assert.equal(d.date,'');assert.equal(d.selected,false);});
