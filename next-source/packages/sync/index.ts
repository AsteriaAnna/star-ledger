// Node composition root; portable logic lives in core.ts.
import {createHash} from 'node:crypto';
import {PortableSyncEngine,makeBatch as buildBatch} from './core.ts';
import type {SyncProvider} from './core.ts';
import type {SyncStore} from '../platform/ports.ts';
import type {Operation} from '../domain/index.ts';
export {FakeSyncProvider} from './core.ts';
export type {SyncProvider} from './core.ts';
export const nodeChecksum=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const makeBatch=(operations:Operation[])=>buildBatch(operations,nodeChecksum);
export class SyncEngine extends PortableSyncEngine {
 constructor(store:SyncStore,provider:SyncProvider){super(store,provider,nodeChecksum);}
}
