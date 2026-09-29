import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {fields} from '../domain/index.ts';
import type {Store,Operation,Entity,EntityType,Conflict,FieldVersion} from '../domain/index.ts';
import type {SyncStore} from '../platform/ports.ts';
import type {Batch} from '../domain/index.ts';
export class SqliteStore implements SyncStore {
 readonly db:DatabaseSync;
 constructor(path:string,device:string) {
  this.db=new DatabaseSync(path); this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  try {
  const exists=this.db.prepare("SELECT name FROM sqlite_master WHERE name='schema_version'").get();
  if(!exists) this.atomic(()=>this.db.exec(readFileSync(new URL('./migrations/001.sql',import.meta.url),'utf8')));
  const version=this.db.prepare('SELECT MAX(version) v FROM schema_version').get()?.v;
  if(version!==1&&version!==2&&version!==3&&version!==4)throw Error('UNSUPPORTED_SCHEMA');
  const old=this.db.prepare('SELECT device_id FROM sync_devices').get();
  if(old && old.device_id!==device) throw Error('DEVICE_ID_MISMATCH');
  if(version===1)this.atomic(()=>this.db.exec(readFileSync(new URL('./migrations/002.sql',import.meta.url),'utf8')));
  if(version===1||version===2)this.atomic(()=>this.db.exec(readFileSync(new URL('./migrations/003.sql',import.meta.url),'utf8')));
  if(Number(version)<4)this.atomic(()=>this.db.exec(readFileSync(new URL('./migrations/004.sql',import.meta.url),'utf8')));
  this.db.prepare('INSERT OR IGNORE INTO sync_devices VALUES(?)').run(device);
  }catch(error){this.db.close();throw error;}
 }
 atomic<T>(work:()=>T):T {
  this.db.exec('BEGIN IMMEDIATE');
  try {const result=work(); this.db.exec('COMMIT'); return result;} catch(e) {this.db.exec('ROLLBACK');throw e;}
 }
 allOperations():Operation[] {return this.db.prepare('SELECT payload FROM sync_operations ORDER BY id').all().map(r=>JSON.parse(r.payload as string));}
 append(op:Operation,local:boolean):void {
  this.db.prepare('INSERT INTO sync_operations VALUES(?,?,?,?)').run(op.id,op.device,op.seq,JSON.stringify(op));
  this.db.prepare('INSERT INTO sync_applied_ops VALUES(?)').run(op.id);
  if(local)this.db.prepare('INSERT INTO sync_outbox VALUES(?)').run(op.id);
 }
 project(entities:Entity[],conflicts:Conflict[],versions:FieldVersion[]):void {
  // Prototype projection rebuild: never remove source evidence or physically delete facts.
  const order:EntityType[]=['transactions','accounts','source_records','balance_movements','consumption_effects','transaction_links','import_rules'];
  for(const type of order)for(const e of entities.filter(e=>e.type===type)) {
   const keys=Object.keys(fields[type]);
   this.db.prepare(`INSERT INTO ${type}(id,${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')},?) ON CONFLICT(id) DO UPDATE SET ${keys.map(k=>`${k}=excluded.${k}`).join(',')}`).run(e.id,...keys.map(k=>e.fields[k] as string|number|null));
  }
  this.db.exec('DELETE FROM field_versions');
  for(const v of versions)this.db.prepare('INSERT INTO field_versions VALUES(?,?,?,?)').run(v.type,v.id,v.field,JSON.stringify(v.ids));
  this.db.exec('DELETE FROM sync_conflicts');
  for(const c of conflicts)this.db.prepare('INSERT INTO sync_conflicts VALUES(?,?)').run(c.id,JSON.stringify(c));
 }
 get(type:EntityType,id:string):Entity|undefined {
  if(!Object.hasOwn(fields,type)) throw Error('INVALID_ENTITY');
  const row=this.db.prepare(`SELECT * FROM ${type} WHERE id=?`).get(id);
  if(!row)return; const {id:_,...rest}=row; return {type,id,fields:rest as Entity['fields']};
 }
 conflicts():Conflict[] {return this.db.prepare('SELECT payload FROM sync_conflicts ORDER BY id').all().map(r=>JSON.parse(r.payload as string));}
 pendingOperations():Operation[] {return this.db.prepare('SELECT o.payload FROM sync_outbox x JOIN sync_operations o ON o.id=x.operation_id ORDER BY o.seq').all().map(r=>JSON.parse(r.payload as string));}
 acknowledgeOperations(ids:string[]):void {this.atomic(()=>{for(const id of ids)this.db.prepare('DELETE FROM sync_outbox WHERE operation_id=?').run(id);});}
 recordBatches(batches:Batch[]):void {for(const b of batches){this.db.prepare('INSERT OR IGNORE INTO sync_batches VALUES(?,?,?)').run(b.device,b.seq,b.checksum);this.db.prepare('INSERT INTO sync_remote_cursors VALUES(?,?) ON CONFLICT(device) DO UPDATE SET seq=MAX(seq,excluded.seq)').run(b.device,b.seq);}}
 knownBatches():{device:string;seq:number;checksum:string}[] {return this.db.prepare('SELECT device,seq,checksum FROM sync_batches').all() as {device:string;seq:number;checksum:string}[];}
 getEnvelope(id:string):string|undefined {return this.db.prepare('SELECT envelope FROM sync_encrypted_outbox WHERE command_id=?').get(id)?.envelope as string|undefined;}
 saveEnvelopeIfAbsent(id:string,envelope:string):string {this.db.prepare('INSERT OR IGNORE INTO sync_encrypted_outbox VALUES(?,?)').run(id,envelope);return this.getEnvelope(id)!;}
 acknowledgedEnvelopes():string[] {return this.db.prepare('SELECT envelope FROM sync_encrypted_outbox e WHERE NOT EXISTS (SELECT 1 FROM sync_outbox o WHERE o.operation_id=e.command_id)').all().map(r=>r.envelope as string);}
 close():void {this.db.close();}
}
