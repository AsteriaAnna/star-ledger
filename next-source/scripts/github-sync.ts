import {readFileSync,existsSync} from 'node:fs';
import {SqliteStore} from '../packages/storage/index.ts';
import {GitHubSyncProvider} from '../packages/sync/github.ts';
import {SecureSyncEngine} from '../packages/sync/secure-engine.ts';
function required(name:string):string {const value=process.env[name];if(!value)throw Error(`MISSING_${name}`);return value;}
let store:SqliteStore|undefined;
try {
 const path=required('LEDGER_DB');if(!existsSync(path))throw Error('LEDGER_DB_NOT_FOUND');
 const device=required('LEDGER_DEVICE'),ledger=required('LEDGER_ID');
 const key=readFileSync(required('LEDGER_KEY_FILE'),'utf8').trim();
 const provider=new GitHubSyncProvider({owner:required('LEDGER_GITHUB_OWNER'),repo:required('LEDGER_GITHUB_REPO'),branch:process.env.LEDGER_GITHUB_BRANCH??'main',ledger,token:required('LEDGER_GITHUB_TOKEN')});
 store=new SqliteStore(path,device);
 await new SecureSyncEngine(store,provider,ledger,key).sync();
 console.log('SYNC_COMPLETE');
}catch(error){const message=error instanceof Error?error.message:'';console.error(/^[A-Z0-9_]+$/.test(message)?message:'SYNC_FAILED');process.exitCode=1;}
finally{store?.close();}
