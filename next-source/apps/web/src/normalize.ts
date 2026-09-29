import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
export const hash=(v:unknown)=>bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(v))));
export function money(value:string):number{
 const s=value.trim().replace(/^[¥￥]\s*/,'').replace(/\s*元$/,'').trim();
 if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s))throw Error('金额需要是最多两位小数的正数');
 const [a,b='']=s.replace(/,/g,'').split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));
 if(!Number.isSafeInteger(n)||n<=0)throw Error('请输入有效金额');return n;
}
export function wallDate(value:string|Date){
 const raw=value instanceof Date?value.toISOString().slice(0,19):value.trim();
 const m=raw.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
 if(!m)return {wall:'',utc:'',precision:'invalid'};
 const [y,mo,d,h=0,mi=0,se=0]=m.slice(1).map(x=>x===undefined?undefined:Number(x)) as number[];
 const dt=new Date(Date.UTC(y,mo-1,d,h,mi,se));
 if(y<1900||dt.getUTCFullYear()!==y||dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d||h>23||mi>59||se>59)return {wall:'',utc:'',precision:'invalid'};
 const day=dt.toISOString().slice(0,10);if(m[4]===undefined)return {wall:day,utc:'',precision:'day'};
 const wall=dt.toISOString().slice(0,19);return {wall,utc:new Date(wall+'+08:00').toISOString(),precision:m[6]===undefined?'minute':'second'};
}
export function sourceUTC(wall:string){const d=wallDate(wall);if(!d.utc)throw Error('请补充有效的交易日期和时间（北京时间）');return d.utc;}
export const ledgerWall=(date:Date)=>new Date(date.getTime()+8*3600000).toISOString().slice(0,19);
export const channelKey=(s:string)=>s.trim().replace(/（/g,'(').replace(/）/g,')').replace(/[ \t]+/g,' ');
export const emptyChannel=(s:string)=>!s.trim()||['/','-','--'].includes(s.trim());
export const compoundChannel=(s:string)=>/[&＆+＋]|组合支付|组合付款/.test(s);
