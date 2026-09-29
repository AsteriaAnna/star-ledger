import type {AsyncLedgerRepository,LedgerRevision} from '../platform/async-accounting.ts';
import type {Operation} from '../domain/index.ts';
import {SqliteStore} from './index.ts';
import {validate} from '../domain/index.ts';
import {project} from '../sync/projection.ts';
/** Reference implementation for the native bridge contract; SQLite remains in one transaction. */
export class AsyncNodeRepository implements AsyncLedgerRepository {
 private store:SqliteStore;
 constructor(store:SqliteStore){this.store=store;}
 async read():Promise<LedgerRevision>{const operations=this.store.allOperations();return {revision:operations.length,operations};}
 async commit(expectedRevision:number,operations:Operation[]):Promise<void>{
  this.store.atomic(()=>{
   const history=this.store.allOperations();if(history.length!==expectedRevision)throw Error('STALE_STORAGE_REVISION');
   if(!operations.length)return;
   const first=operations[0];
   if(first.command_index!==0||first.command_size!==operations.length)throw Error('INCOMPLETE_COMMAND');
   const local=this.store.db.prepare('SELECT device_id FROM sync_devices').get()?.device_id;
   const lastSeq=Math.max(0,...history.filter(o=>o.device===local).map(o=>o.seq));
   for(const [index,op] of operations.entries()){
    validate(op);if(op.device!==local||op.seq!==lastSeq+index+1||op.command_id!==first.command_id||op.command_index!==index||op.command_size!==operations.length)throw Error('INVALID_COMMAND_GROUP');
   }
   const p=project([...history,...operations]);this.store.project(p.entities,p.conflicts,p.versions);
   for(const op of operations)this.store.append(op,true);
  });
 }
}
