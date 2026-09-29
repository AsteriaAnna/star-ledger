import type {Operation,Entity,EntityType,Batch,Conflict,FieldVersion} from '../../../packages/domain/index.ts';
import type {SyncStore} from '../../../packages/platform/ports.ts';
import type {BusinessCommand} from '../../../packages/domain/accounting.ts';
import {AccountingService,type Command} from '../../../packages/accounting/index.ts';
import {BusinessAccountingService} from '../../../packages/accounting/business.ts';
import {project} from '../../../packages/sync/projection.ts';
import {PortableSyncEngine,FakeSyncProvider} from '../../../packages/sync/core.ts';
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
import {GitHubSyncProvider} from '../../../packages/sync/github.ts';
import {webSessionCrypto} from '../../../packages/platform/web-crypto.ts';
export const hash=(v:unknown)=>bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(v))));
export type State={version:1;revision:number;device:string;ops:Operation[];pending:string[];batches:{device:string;seq:number;checksum:string}[];envelopes:Record<string,string>;settings:Record<string,any>};
export const fresh=():State=>({version:1,revision:0,device:crypto.randomUUID(),ops:[],pending:[],batches:[],envelopes:{},settings:{budget:300000,categories:['餐饮','购物','交通','生活','娱乐','学习','医疗','其他'],mode:'auto'}});
export class MemoryStore implements SyncStore {
 state:State;entities:Entity[];
 constructor(state:State){this.state=structuredClone(state);this.entities=project(state.ops).entities;}
 atomic<T>(fn:()=>T):T{const s=structuredClone(this.state),e=this.entities;try{return fn();}catch(err){this.state=s;this.entities=e;throw err;}}
 allOperations(){return structuredClone(this.state.ops);}
 append(op:Operation,local:boolean){this.state.ops.push(structuredClone(op));if(local)this.state.pending.push(op.id);}
 project(entities:Entity[],_c:Conflict[],_v:FieldVersion[]){this.entities=entities;}
 get(type:EntityType,id:string){return this.entities.find(e=>e.type===type&&e.id===id);}
 pendingOperations(){const ids=new Set(this.state.pending);return this.state.ops.filter(o=>ids.has(o.id));}
 acknowledgeOperations(ids:string[]){const set=new Set(ids);this.state.pending=this.state.pending.filter(id=>!set.has(id));}
 recordBatches(b:Batch[]){const m=new Map(this.state.batches.map(x=>[`${x.device}:${x.seq}`,x]));b.forEach(x=>m.set(`${x.device}:${x.seq}`,{device:x.device,seq:x.seq,checksum:x.checksum}));this.state.batches=[...m.values()];}
 knownBatches(){return this.state.batches;}
 getEnvelope(id:string){return this.state.envelopes[id];}
 saveEnvelopeIfAbsent(id:string,e:string){return this.state.envelopes[id]??(this.state.envelopes[id]=e);}
 acknowledgedEnvelopes(){return Object.entries(this.state.envelopes).filter(([id])=>!this.state.ops.some(o=>o.command_id===id&&this.state.pending.includes(o.id))).map(([,e])=>e);}
}
let db:IDBDatabase;let queue=Promise.resolve();
export async function openStore(){db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('star-ledger-next-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('ledger');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});if(!await read())await write(fresh(),-1);}
export async function read():Promise<State>{return new Promise((resolve,reject)=>{const r=db.transaction('ledger').objectStore('ledger').get('main');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function write(state:State,expected:number){return new Promise<void>((resolve,reject)=>{const tx=db.transaction('ledger','readwrite');const s=tx.objectStore('ledger');const r=s.get('main');let reason:Error|undefined;r.onsuccess=()=>{if((r.result?.revision??-1)!==expected){reason=Error('账本已在其他窗口更新，请重试');tx.abort();return;}s.put({...state,revision:expected+1},'main');};tx.oncomplete=()=>resolve();tx.onabort=()=>reject(reason??tx.error??Error('保存失败'));tx.onerror=()=>reject(tx.error);});}
export function exclusive<T>(fn:()=>Promise<T>):Promise<T>{const run=()=>navigator.locks?navigator.locks.request('star-ledger-next-write',fn):fn();const p=queue.then(run,run);queue=p.then(()=>{},()=>{});return p;}
export async function mutate(fn:(store:MemoryStore)=>void){return exclusive(async()=>{const s=await read();const store=new MemoryStore(s);fn(store);await write(store.state,s.revision);});}
export async function business(command:BusinessCommand){return mutate(s=>{new BusinessAccountingService(s,s.state.device).execute(command);});}
export async function raw(commands:Command[]){return mutate(s=>{new AccountingService(s,s.state.device).execute(commands);});}
export async function settings(values:Record<string,any>){return mutate(s=>{Object.assign(s.state.settings,values);});}
export async function backup(){const s=await read();return JSON.stringify({format:'star-ledger-web-backup',version:1,exportedAt:new Date().toISOString(),operations:s.ops,settings:s.settings},null,2);}
export async function restore(text:string){const b=JSON.parse(text);if(b.format!=='star-ledger-web-backup'||b.version!==1||!Array.isArray(b.operations)||b.operations.length>100000)throw Error('不是有效的星账新版备份');return mutate(s=>{const groups=new Map<string,Operation[]>();for(const op of b.operations){const g=groups.get(op.command_id)??[];g.push(op);groups.set(op.command_id,g);}const batches=[...groups.values()].map(ops=>{ops.sort((a,b)=>a.command_index-b.command_index);const body={version:1 as const,device:ops[0].device,seq:ops[0].seq,operations:ops};return {...body,checksum:hash(body)};});new PortableSyncEngine(s,new FakeSyncProvider(),hash).applyBatches(batches);s.state.pending=[...new Set([...s.state.pending,...s.state.ops.map(o=>o.id)])];if(b.settings&&typeof b.settings==='object'){const {budget,categories}=b.settings;if(Number.isSafeInteger(budget)&&budget>0)s.state.settings.budget=budget;if(Array.isArray(categories)&&categories.every(c=>typeof c==='string'&&c.length<60))s.state.settings.categories=categories;}});}
export async function synchronize(config:{owner:string;repo:string;branch:string;ledger:string;token:string;key:string},progress:(s:string)=>void){return exclusive(async()=>{
 let state=await read();const target=`${config.owner}/${config.repo}/${config.branch}/${config.ledger}`;
 if(state.settings.syncTarget&&state.settings.syncTarget!==target)throw Error('此账本已绑定另一同步位置。请使用原来的仓库、分支和账本 ID。');
 const provider=new GitHubSyncProvider(config);const cipher=await webSessionCrypto(config.ledger,config.key);await provider.healthCheck();
 // Persist every ciphertext before upload, and every acknowledgement after the remote write.
 let store=new MemoryStore(state);
 progress('先核验已有远端记录');const priorFiles=await provider.list();const priorBatches:Batch[]=[];const priorEnvelopes=new Map<string,string>();
 const remotePath=(b:Batch)=>`ledger-sync/${config.ledger}/${b.device}/${String(b.seq).padStart(16,'0')}.json`;
 for(const f of priorFiles){const envelope=await provider.download(f);const b=await cipher.open(envelope);if(remotePath(b)!==f.path)throw Error('REMOTE_PATH_MISMATCH');priorBatches.push(b);priorEnvelopes.set(b.operations[0]?.command_id,envelope);}
 for(const known of store.knownBatches())if(!priorBatches.some(b=>b.device===known.device&&b.seq===known.seq&&b.checksum===known.checksum))throw Error('REMOTE_HISTORY_MISSING');
 new PortableSyncEngine(store,new FakeSyncProvider(),hash).applyBatches(priorBatches);
 for(const b of priorBatches){store.acknowledgeOperations(b.operations.map(o=>o.id));}
 store.state.settings.syncTarget=target;
 await write(store.state,state.revision);state=await read();store=new MemoryStore(state);
 const core=new PortableSyncEngine(store,new FakeSyncProvider(),hash);
 const pending=core.pendingBatches();
 const path=(b:Batch)=>`ledger-sync/${config.ledger}/${b.device}/${String(b.seq).padStart(16,'0')}.json`;
 for(let i=0;i<pending.length;i++){const b=pending[i];progress(`上传 ${i+1} / ${pending.length}`);let e=store.getEnvelope(b.operations[0].command_id);if(!e){e=await cipher.seal(b);store.saveEnvelopeIfAbsent(b.operations[0].command_id,e);await write(store.state,state.revision);state=await read();store=new MemoryStore(state);}else await cipher.open(e);
 await provider.upload(path(b),e);store.acknowledgeOperations(b.operations.map(o=>o.id));await write(store.state,state.revision);state=await read();store=new MemoryStore(state);}
 progress('核验并下载远端记录');const files=await provider.list();const batches:Batch[]=[];
 for(const f of files){const b=await cipher.open(await provider.download(f));if(path(b)!==f.path)throw Error('REMOTE_PATH_MISMATCH');batches.push(b);}
 for(const e of store.acknowledgedEnvelopes()){const b=await cipher.open(e);if(!batches.some(r=>r.device===b.device&&r.seq===b.seq&&r.checksum===b.checksum))throw Error('UPLOADED_HISTORY_MISSING');}
 for(const known of store.knownBatches())if(!batches.some(b=>b.device===known.device&&b.seq===known.seq&&b.checksum===known.checksum))throw Error('REMOTE_HISTORY_MISSING');
 new PortableSyncEngine(store,new FakeSyncProvider(),hash).applyBatches(batches);Object.assign(store.state.settings,{syncTarget:target,syncConfig:{owner:config.owner,repo:config.repo,branch:config.branch,ledger:config.ledger},lastSync:new Date().toISOString()});await write(store.state,state.revision);
 });}
