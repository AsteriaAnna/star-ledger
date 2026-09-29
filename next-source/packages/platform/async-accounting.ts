import type {Operation,Store,Entity,EntityType,Conflict,FieldVersion} from '../domain/index.ts';
import type {BusinessCommand} from '../domain/accounting.ts';
import {BusinessAccountingService} from '../accounting/business.ts';
import {project} from '../sync/projection.ts';

export type LedgerRevision={revision:number;operations:Operation[]};
/** Native implementation must check revision and persist facts+outbox within ONE transaction. */
export interface AsyncLedgerRepository {
 read():Promise<LedgerRevision>;
 commit(expectedRevision:number,operations:Operation[]):Promise<void>;
}
class StagingStore implements Store {
 private operations:Operation[];private entities:Entity[];
 constructor(operations:Operation[]){this.operations=structuredClone(operations);this.entities=project(this.operations).entities;}
 atomic<T>(work:()=>T):T {const previous=structuredClone({operations:this.operations,entities:this.entities});try{return work();}catch(error){this.operations=previous.operations;this.entities=previous.entities;throw error;}}
 allOperations():Operation[]{return structuredClone(this.operations);}
 append(op:Operation,_local:boolean):void{this.operations.push(structuredClone(op));}
 project(entities:Entity[],_conflicts:Conflict[],_versions:FieldVersion[]):void{this.entities=structuredClone(entities);}
 get(type:EntityType,id:string):Entity|undefined{return this.entities.find(e=>e.type===type&&e.id===id);}
}
export class AsyncAccountingService {
 private repository:AsyncLedgerRepository;private device:string;
 constructor(repository:AsyncLedgerRepository,device:string){this.repository=repository;this.device=device;}
 async execute(command:BusinessCommand):Promise<Operation[]> {
  const snapshot=await this.repository.read();
  const operations=new BusinessAccountingService(new StagingStore(snapshot.operations),this.device).execute(command);
  if(operations.length)await this.repository.commit(snapshot.revision,operations);
  return operations;
 }
}
