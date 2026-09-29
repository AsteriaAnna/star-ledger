import {SqliteStore} from '../packages/storage/index.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import {SyncEngine,FakeSyncProvider} from '../packages/sync/index.ts';
import type {Entity,Json} from '../packages/domain/index.ts';
export const transaction=(id='t'):Entity=>({type:'transactions',id,fields:{event_type:'PURCHASE',status:'SUCCESS',occurred_at:'2026-09-28T09:00:00Z',display_amount:4400,display_name:'Merchant A',note:'',created_at:'2026-09-28T09:00:00Z',deleted_at:null}});
export const effect=(id='e',transactionId='t'):Entity=>({type:'consumption_effects',id,fields:{transaction_id:transactionId,amount:4400,category_id:null,subcategory_id:null,effective_at:'2026-09-28T09:00:00Z',created_at:'2026-09-28T09:00:00Z'}});
export const create=(entity:Entity)=>({action:'CREATE_ENTITY' as const,entity});
export const patch=(type:Entity['type'],id:string,field:string,value:Json)=>({action:'PATCH_FIELD' as const,entity:{type,id,fields:{[field]:value}}});
export function device(id:string,remote:FakeSyncProvider,path=':memory:') {const store=new SqliteStore(path,id);return {store,service:new AccountingService(store,id),sync:new SyncEngine(store,remote)};}
export function pair(t:{after:(f:()=>void)=>void}){const remote=new FakeSyncProvider();const a=device('a',remote),b=device('b',remote);t.after(()=>{a.store.close();b.store.close();});return {a,b,remote};}
export function seed(a:ReturnType<typeof device>,b:ReturnType<typeof device>){a.service.execute([create(transaction()),create(effect())]);a.sync.sync();b.sync.sync();}
export function converge(a:ReturnType<typeof device>,b:ReturnType<typeof device>){a.sync.upload();b.sync.upload();a.sync.download();b.sync.download();}
