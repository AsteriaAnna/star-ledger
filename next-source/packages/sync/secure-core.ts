import type {Batch} from '../domain/index.ts';
import type {SyncStore,SessionCrypto,BatchLedger} from '../platform/ports.ts';
import type {EncryptedProvider} from './github.ts';
export class PortableSecureSyncEngine {
 private store:SyncStore;private provider:EncryptedProvider;private ledger:string;private crypto:SessionCrypto;private core:BatchLedger;private busy=false;
 constructor(store:SyncStore,provider:EncryptedProvider,ledger:string,crypto:SessionCrypto,core:BatchLedger) {
  if(!/^[\w-]{1,100}$/.test(ledger))throw Error('INVALID_LEDGER_ID');
  this.store=store;this.provider=provider;this.ledger=ledger;this.crypto=crypto;this.core=core;
 }
 private path(b:Batch){return `ledger-sync/${this.ledger}/${b.device}/${String(b.seq).padStart(16,'0')}.json`;}
 async sync(hooks?:{afterUpload?:()=>void}):Promise<void> {
  if(this.busy)throw Error('SYNC_ALREADY_RUNNING');this.busy=true;
  try {
   await this.provider.healthCheck();
   for(const batch of this.core.pendingBatches()) {
    const id=batch.operations[0].command_id;
    let saved=this.store.getEnvelope(id);
    if(!saved)saved=this.store.saveEnvelopeIfAbsent(id,await this.crypto.seal(batch));
    if(JSON.stringify(await this.crypto.open(saved))!==JSON.stringify(batch))throw Error('LOCAL_ENVELOPE_MISMATCH');
    await this.provider.upload(this.path(batch),saved);hooks?.afterUpload?.();this.core.acknowledge(batch);
   }
   const files=await this.provider.list();const batches:Batch[]=[];
   for(const file of files){const b=await this.crypto.open(await this.provider.download(file));if(file.path!==this.path(b))throw Error('REMOTE_PATH_MISMATCH');batches.push(b);}
   for(const saved of this.store.acknowledgedEnvelopes()) {
    const b=await this.crypto.open(saved);
    if(!batches.some(remote=>remote.device===b.device&&remote.seq===b.seq&&remote.checksum===b.checksum))throw Error('UPLOADED_HISTORY_MISSING');
   }
   // A previously accepted remote batch disappearing is rollback/tampering, not successful sync.
   for(const known of this.store.knownBatches())if(!batches.some(b=>b.device===known.device&&b.seq===known.seq&&b.checksum===known.checksum))throw Error('REMOTE_HISTORY_MISSING');
   this.core.applyBatches(batches);
  }finally{this.busy=false;}
 }
}
