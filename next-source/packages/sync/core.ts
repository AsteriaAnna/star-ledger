import type {Batch,Operation} from '../domain/index.ts';
import {validate} from '../domain/index.ts';
import type {SyncStore,JsonChecksum} from '../platform/ports.ts';
import {project} from './projection.ts';
export function makeBatch(operations:Operation[],hash:JsonChecksum):Batch {const op=operations[0];const b={version:1 as const,device:op.device,seq:op.seq,operations};return {...b,checksum:hash(b)};}
export interface SyncProvider {list():Batch[];upload(batch:Batch):void;}
export class FakeSyncProvider implements SyncProvider {
 batches=new Map<string,Batch>(); online=true;
 list():Batch[]{if(!this.online)throw Error('OFFLINE');return structuredClone([...this.batches.values()]);}
 upload(b:Batch):void {if(!this.online)throw Error('OFFLINE');const k=`${b.device}:${b.seq}`,old=this.batches.get(k);if(old&&old.checksum!==b.checksum)throw Error('REMOTE_COLLISION');this.batches.set(k,structuredClone(b));}
}
function hasAncestor(ops:Operation[],id:string,target:string,seen=new Set<string>()):boolean {
 if(seen.has(id))return false;seen.add(id);
 return ops.find(o=>o.id===id)?.parents.some(p=>p===target||hasAncestor(ops,p,target,seen))??false;
}
export class PortableSyncEngine {
 private store:SyncStore; private provider:SyncProvider; private hash:JsonChecksum;
 constructor(store:SyncStore,provider:SyncProvider,hash:JsonChecksum){this.store=store;this.provider=provider;this.hash=hash;}
 pendingBatches():Batch[] {
  const pending=this.store.pendingOperations();
  return [...new Set(pending.map(o=>o.command_id))].map(command=>makeBatch(pending.filter(o=>o.command_id===command),this.hash));
 }
 acknowledge(batch:Batch):void {
  this.store.acknowledgeOperations(batch.operations.map(op=>op.id));
 }
 upload(afterUpload?:()=>void):void {
  for(const batch of this.pendingBatches()){this.provider.upload(batch);afterUpload?.();this.acknowledge(batch);}
 }
 download(fault?:()=>void):void {
  const batches=this.provider.list(); // Never advance cursor for a failed download.
  this.applyBatches(batches,fault);
 }
 applyBatches(batches:Batch[],fault?:()=>void):void {
  this.store.atomic(()=>{
   const ops=this.store.allOperations();const map=new Map(ops.map(o=>[o.id,o]));
   for(const batch of batches) {
    const {checksum,...body}=batch;
    if(batch.version!==1||this.hash(body)!==checksum||!batch.operations.length)throw Error('CORRUPT_BATCH');
    const first=batch.operations[0];
    if(first.seq!==batch.seq||first.device!==batch.device||first.command_size!==batch.operations.length)throw Error('INVALID_BATCH_HEADER');
    for(const [index,op] of batch.operations.entries()) {
     validate(op);
     if(op.device!==batch.device||op.seq!==batch.seq+index||op.command_id!==first.command_id||op.command_index!==index||op.command_size!==first.command_size)throw Error('INCOMPLETE_COMMAND');
     const old=map.get(op.id);
     if(old&&JSON.stringify(old)!==JSON.stringify(op))throw Error('OPERATION_COLLISION');
     if(!old){map.set(op.id,op);ops.push(op);this.store.append(op,false);}
    }
   }
   for(const device of new Set(ops.map(o=>o.device))) {
    const seqs=ops.filter(o=>o.device===device).map(o=>o.seq).sort((a,b)=>a-b);
    if(seqs.some((s,i)=>s!==i+1))throw Error('SEQUENCE_GAP');
    for(let i=1;i<seqs.length;i++)if(!hasAncestor(ops,`${device}:${seqs[i]}`,`${device}:${seqs[i-1]}`))throw Error('INVALID_DEVICE_CHAIN');
   }
   const p=project(ops);this.store.project(p.entities,p.conflicts,p.versions);fault?.();
   this.store.recordBatches(batches);
  });
 }
 sync():void {this.upload();this.download();}
}
