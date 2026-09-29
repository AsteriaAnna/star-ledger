import type {Batch,Operation,Store} from '../domain/index.ts';
/** Synchronous transaction-session contract. Do not implement as separate async SQL calls. */
export interface SyncStore extends Store {
 pendingOperations():Operation[];
 acknowledgeOperations(ids:string[]):void;
 recordBatches(batches:Batch[]):void;
 knownBatches():{device:string;seq:number;checksum:string}[];
 getEnvelope(commandId:string):string|undefined;
 saveEnvelopeIfAbsent(commandId:string,envelope:string):string;
 acknowledgedEnvelopes():string[];
}
export type MaybePromise<T>=T|Promise<T>;
export interface SessionCrypto {
 seal(batch:Batch):MaybePromise<string>;
 open(envelope:string):MaybePromise<Batch>;
}
export interface BatchLedger {
 pendingBatches():Batch[];
 acknowledge(batch:Batch):void;
 applyBatches(batches:Batch[]):void;
}
export type JsonChecksum=(value:unknown)=>string;
