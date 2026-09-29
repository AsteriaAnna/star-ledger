import {writeFileSync} from 'node:fs';
import {newRecoveryKey} from '../packages/sync/crypto.ts';
try {
 const path=process.argv[2];if(!path)throw Error('KEY_FILE_REQUIRED');
 writeFileSync(path,newRecoveryKey()+'\n',{flag:'wx',mode:0o600});
 console.log('KEY_FILE_CREATED');
}catch{console.error('KEY_CREATION_FAILED');process.exitCode=1;}
