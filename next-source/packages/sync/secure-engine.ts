import type {SyncStore} from '../platform/ports.ts';
import type {EncryptedProvider} from './github.ts';
import {SyncEngine,FakeSyncProvider} from './index.ts';
import {PortableSecureSyncEngine} from './secure-core.ts';
import {seal,unseal,parseRecoveryKey} from './crypto.ts';
export class SecureSyncEngine extends PortableSecureSyncEngine {
 constructor(store:SyncStore,provider:EncryptedProvider,ledger:string,recoveryKey:string){
  const key=parseRecoveryKey(recoveryKey);
  super(store,provider,ledger,{seal:batch=>seal(batch,ledger,key),open:value=>unseal(value,ledger,key)},new SyncEngine(store,new FakeSyncProvider()));
 }
}
