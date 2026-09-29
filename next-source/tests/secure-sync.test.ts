import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SqliteStore} from '../packages/storage/index.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {GitHubSyncProvider} from '../packages/sync/github.ts';
import {SecureSyncEngine} from '../packages/sync/secure-engine.ts';
import {newRecoveryKey,parseRecoveryKey,seal,unseal} from '../packages/sync/crypto.ts';
import {makeBatch} from '../packages/sync/index.ts';
import {pair,create,transaction} from './helpers.ts';

/** HTTP contract simulator: calls the actual GitHub provider, never github.com. */
class MockGitHub {
 files=new Map<string,string>();blobs=new Map<string,string>();writes=0;privateRepo=true;truncated=false;
 failAfterWrite=false;status=200;conflictOnce=false;failBlob=0;blobReads=0;
 requests:{url:string;method:string}[]=[];
 response(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});}
 transport=async(url:string,init:RequestInit):Promise<Response>=>{
  this.requests.push({url,method:init.method??'GET'});
  assert.equal((init.headers as Record<string,string>).Authorization,'Bearer test-token');assert.equal(init.redirect,'error');
  if(this.status!==200)return this.response({},this.status);
  const u=new URL(url),path=u.pathname.replace('/repos/test/ledger','');
  if(!path)return this.response({private:this.privateRepo});
  if(path.startsWith('/git/trees/'))return this.response({truncated:this.truncated,tree:[...this.files.entries()].map(([path,content])=>({path,type:'blob',mode:'100644',size:Buffer.byteLength(content),sha:this.sha(content)}))});
  if(path.startsWith('/git/blobs/')) {this.blobReads++;if(this.failBlob===this.blobReads)throw Error('connection reset');const content=this.blobs.get(path.split('/').at(-1)!);return content===undefined?this.response({},404):this.response({encoding:'base64',content:Buffer.from(content).toString('base64')});}
  if(path.startsWith('/contents/')) {
   const file=decodeURIComponent(path.slice('/contents/'.length));
   if(init.method==='GET'){const content=this.files.get(file);return content===undefined?this.response({},404):this.response({encoding:'base64',content:Buffer.from(content).toString('base64')});}
   if(init.method==='PUT') {
    if(this.conflictOnce){this.conflictOnce=false;return this.response({},409);}
    const data=JSON.parse(init.body as string);assert.equal(data.sha,undefined);assert.equal(data.branch,'main');
    if(this.files.has(file))return this.response({},422);
    const text=Buffer.from(data.content,'base64').toString('utf8');this.files.set(file,text);this.blobs.set(this.sha(text),text);this.writes++;
    if(this.failAfterWrite){this.failAfterWrite=false;throw Error('response lost after commit');}
    return this.response({content:{sha:this.sha(text)}},201);
   }
  }
  return this.response({},404);
 };
 sha(text:string){return createHash('sha1').update(text).digest('hex');}
 provider(){return new GitHubSyncProvider({owner:'test',repo:'ledger',branch:'main',ledger:'test-ledger',token:'test-token'},this.transport);}
}
function setup(t:Parameters<typeof pair>[0]){const p=pair(t),remote=new MockGitHub(),key=newRecoveryKey();return {...p,remote,key,sa:new SecureSyncEngine(p.a.store,remote.provider(),'test-ledger',key),sb:new SecureSyncEngine(p.b.store,remote.provider(),'test-ledger',key)};}
test('AES-GCM round trip hides merchant and authenticates metadata',t=>{const x=setup(t);const ops=x.a.service.execute([create(transaction())]);const b=makeBatch(ops),key=parseRecoveryKey(x.key),text=seal(b,'test-ledger',key);assert.ok(!text.includes('Merchant A'));assert.deepEqual(unseal(text,'test-ledger',key),b);const changed=JSON.parse(text);changed.seq++;assert.throws(()=>unseal(JSON.stringify(changed),'test-ledger',key),/AUTHENTICATION_FAILED/);});
test('same plaintext gets distinct nonces; durable retry is handled separately',t=>{const x=setup(t);const b=makeBatch(x.a.service.execute([create(transaction())])),key=parseRecoveryKey(x.key);assert.notEqual(seal(b,'test-ledger',key),seal(b,'test-ledger',key));});
test('wrong key, wrong ledger and unsupported protocol are rejected',t=>{const x=setup(t);const b=makeBatch(x.a.service.execute([create(transaction())])),key=parseRecoveryKey(x.key),text=seal(b,'test-ledger',key);assert.throws(()=>unseal(text,'test-ledger',parseRecoveryKey(newRecoveryKey())),/WRONG_LEDGER_OR_KEY/);assert.throws(()=>unseal(text,'other',key));const e=JSON.parse(text);e.protocol=99;assert.throws(()=>unseal(JSON.stringify(e),'test-ledger',key),/UNSUPPORTED_PROTOCOL/);assert.throws(()=>parseRecoveryKey('password'),/INVALID_RECOVERY_KEY/);});
test('two devices upload encrypted batches and restore the same ledger through GitHub HTTP adapter',async t=>{const x=setup(t);x.a.service.execute([create(transaction('a'))]);x.b.service.execute([create(transaction('b'))]);await x.sa.sync();await x.sb.sync();await x.sa.sync();assert.deepEqual(x.a.store.get('transactions','b'),x.b.store.get('transactions','b'));assert.equal(x.remote.files.size,2);for(const text of x.remote.files.values())assert.ok(!text.includes('Merchant A'));});
test('upload commit with lost response retries the exact saved ciphertext without duplicates',async t=>{const x=setup(t);x.a.service.execute([create(transaction())]);x.remote.failAfterWrite=true;await assert.rejects(()=>x.sa.sync(),/GITHUB_NETWORK_ERROR/);const sealed=[...x.remote.files.values()][0];await x.sa.sync();assert.equal(x.remote.writes,1);assert.equal([...x.remote.files.values()][0],sealed);assert.equal(x.a.store.db.prepare('SELECT count(*) n FROM sync_outbox').get()?.n,0);});
test('crash after successful upload before acknowledgement retries after engine restart',async t=>{const x=setup(t);x.a.service.execute([create(transaction())]);await assert.rejects(()=>x.sa.sync({afterUpload:()=>{throw Error('crash');}}),/crash/);const resumed=new SecureSyncEngine(x.a.store,x.remote.provider(),'test-ledger',x.key);await resumed.sync();assert.equal(x.remote.writes,1);});
test('partial download leaves all downloaded facts and cursors uncommitted',async t=>{const x=setup(t);x.a.service.execute([create(transaction('one'))]);x.a.service.execute([create(transaction('two'))]);await x.sa.sync();x.remote.blobReads=0;x.remote.failBlob=2;await assert.rejects(()=>x.sb.sync(),/GITHUB_NETWORK_ERROR/);assert.equal(x.b.store.allOperations().length,0);assert.equal(x.b.store.db.prepare('SELECT count(*) n FROM sync_remote_cursors').get()?.n,0);x.remote.failBlob=0;await x.sb.sync();assert.equal(x.b.store.allOperations().length,2);});
test('corrupt authenticated content never reaches SQLite',async t=>{const x=setup(t);x.a.service.execute([create(transaction())]);await x.sa.sync();const [path,text]=[...x.remote.files.entries()][0],e=JSON.parse(text);e.tag=Buffer.alloc(16).toString('base64');const corrupted=JSON.stringify(e);x.remote.files.set(path,corrupted);x.remote.blobs.set(x.remote.sha(corrupted),corrupted);await assert.rejects(()=>x.sb.sync(),/AUTHENTICATION_FAILED/);assert.equal(x.b.store.allOperations().length,0);});
test('truncated tree is rejected instead of being treated as complete history',async t=>{const x=setup(t);x.remote.truncated=true;await assert.rejects(()=>x.sb.sync(),/INCOMPLETE_REMOTE_TREE/);});
test('previously accepted remote history disappearing is detected',async t=>{const x=setup(t);x.a.service.execute([create(transaction())]);await x.sa.sync();await x.sb.sync();x.remote.files.clear();await assert.rejects(()=>x.sb.sync(),/REMOTE_HISTORY_MISSING/);assert.ok(x.b.store.get('transactions','t'));});
test('nonzero sequence gap is rejected on a new device',async t=>{const x=setup(t);x.a.service.execute([create(transaction('one'))]);x.a.service.execute([create(transaction('two'))]);await x.sa.sync();x.remote.files.delete([...x.remote.files.keys()][0]);await assert.rejects(()=>x.sb.sync(),/SEQUENCE_GAP/);assert.equal(x.b.store.allOperations().length,0);});
test('public repo is rejected before uploading any ledger data',async t=>{const x=setup(t);x.a.service.execute([create(transaction())]);x.remote.privateRepo=false;await assert.rejects(()=>x.sa.sync(),/PRIVATE_SYNC_REPO_REQUIRED/);assert.equal(x.remote.writes,0);});
test('authentication and rate-limit errors keep pending operations',async t=>{const x=setup(t);x.a.service.execute([create(transaction())]);for(const status of [401,403,429]){x.remote.status=status;await assert.rejects(()=>x.sa.sync(),/GITHUB_/);assert.equal(x.a.store.db.prepare('SELECT count(*) n FROM sync_outbox').get()?.n,1);}x.remote.status=200;await x.sa.sync();});
test('GitHub branch write conflict can be retried without overwriting',async t=>{const x=setup(t);x.a.service.execute([create(transaction())]);x.remote.conflictOnce=true;await assert.rejects(()=>x.sa.sync(),/GITHUB_WRITE_CONFLICT/);await x.sa.sync();assert.equal(x.remote.writes,1);});
test('existing remote file with different bytes is never overwritten',async t=>{const x=setup(t);const provider=x.remote.provider(),path='ledger-sync/test-ledger/a/0000000000000001.json';await provider.upload(path,'first');await assert.rejects(()=>provider.upload(path,'different'),/REMOTE_COLLISION/);assert.equal(x.remote.files.get(path),'first');});
test('remote path must match authenticated batch identity',async t=>{const x=setup(t);x.a.service.execute([create(transaction())]);await x.sa.sync();const [path,body]=[...x.remote.files.entries()][0];x.remote.files.delete(path);x.remote.files.set(path.replace('/a/','/b/'),body);await assert.rejects(()=>x.sb.sync(),/REMOTE_PATH_MISMATCH/);});
test('same-engine overlapping sync is rejected',async t=>{const x=setup(t);let release:()=>void=()=>{};const wait=new Promise<void>(r=>release=r);const provider=x.remote.provider();provider.healthCheck=()=>wait;const engine=new SecureSyncEngine(x.a.store,provider,'test-ledger',x.key);const first=engine.sync();await assert.rejects(()=>engine.sync(),/SYNC_ALREADY_RUNNING/);release();await first;});

test('persisted ciphertext survives closing and reopening a real database',async()=>{const dir=mkdtempSync(join(tmpdir(),'ledger-secure-')),path=join(dir,'a.db'),remote=new MockGitHub(),key=newRecoveryKey();let db:SqliteStore|undefined;try{db=new SqliteStore(path,'a');new AccountingService(db,'a').execute([create(transaction())]);const engine=new SecureSyncEngine(db,remote.provider(),'test-ledger',key);await assert.rejects(()=>engine.sync({afterUpload:()=>{throw Error('crash');}}));const ciphertext=[...remote.files.values()][0];db.close();db=new SqliteStore(path,'a');await new SecureSyncEngine(db,remote.provider(),'test-ledger',key).sync();assert.equal([...remote.files.values()][0],ciphertext);assert.equal(remote.writes,1);assert.equal(db.db.prepare('SELECT count(*) n FROM sync_outbox').get()?.n,0);}finally{db?.close();rmSync(dir,{recursive:true,force:true});}});
test('just-uploaded batch missing from listed history is not reported as success',async t=>{const x=setup(t);x.a.service.execute([create(transaction())]);const provider=x.remote.provider();provider.list=async()=>[];await assert.rejects(()=>new SecureSyncEngine(x.a.store,provider,'test-ledger',x.key).sync(),/UPLOADED_HISTORY_MISSING/);await assert.rejects(()=>new SecureSyncEngine(x.a.store,provider,'test-ledger',x.key).sync(),/UPLOADED_HISTORY_MISSING/);});
