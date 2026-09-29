import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import type {Batch} from '../domain/index.ts';
import {MAX_ENVELOPE} from '../platform/envelope.ts';
import type {Envelope} from '../platform/envelope.ts';
export {MAX_ENVELOPE};
export type {Envelope};
export function newRecoveryKey():string {return randomBytes(32).toString('base64url');}
export function parseRecoveryKey(value:string):Buffer {
 if(!/^[A-Za-z0-9_-]{43}$/.test(value))throw Error('INVALID_RECOVERY_KEY');
 const key=Buffer.from(value,'base64url');if(key.length!==32||key.toString('base64url')!==value)throw Error('INVALID_RECOVERY_KEY');return key;
}
const identity=(key:Buffer)=>createHash('sha256').update(key).digest('hex').slice(0,32);
function header(e:Envelope){return {format:e.format,protocol:e.protocol,ledger:e.ledger,keyId:e.keyId,device:e.device,seq:e.seq};}
export function seal(batch:Batch,ledger:string,key:Buffer):string {
 if(key.length!==32||!/^[\w-]{1,100}$/.test(ledger))throw Error('INVALID_CRYPTO_CONFIG');
 const plain=Buffer.from(JSON.stringify(batch));if(plain.length>256*1024)throw Error('BATCH_TOO_LARGE');
 const e:Envelope={format:1,protocol:2,ledger,keyId:identity(key),device:batch.device,seq:batch.seq,nonce:'',ciphertext:'',tag:''};
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
 cipher.setAAD(Buffer.from(JSON.stringify(header(e))));
 e.nonce=nonce.toString('base64');e.ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]).toString('base64');e.tag=cipher.getAuthTag().toString('base64');return JSON.stringify(e);
}
function decode(value:unknown,length?:number):Buffer {
 if(typeof value!=='string'||!value||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw Error('INVALID_ENVELOPE');
 const bytes=Buffer.from(value,'base64');if(bytes.toString('base64')!==value||(length!==undefined&&bytes.length!==length))throw Error('INVALID_ENVELOPE');return bytes;
}
export function unseal(text:string,ledger:string,key:Buffer):Batch {
 if(Buffer.byteLength(text)>MAX_ENVELOPE)throw Error('ENVELOPE_TOO_LARGE');
 let e:Envelope;try{e=JSON.parse(text);}catch{throw Error('INVALID_ENVELOPE');}
 if(!e||e.format!==1||e.protocol!==2)throw Error('UNSUPPORTED_PROTOCOL');
 if(e.ledger!==ledger||e.keyId!==identity(key)||!/^[\w-]+$/.test(e.device)||!Number.isSafeInteger(e.seq)||e.seq<1)throw Error('WRONG_LEDGER_OR_KEY');
 const nonce=decode(e.nonce,12),tag=decode(e.tag,16),encrypted=decode(e.ciphertext);
 let plain:Buffer;
 try{const cipher=createDecipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(JSON.stringify(header(e))));cipher.setAuthTag(tag);plain=Buffer.concat([cipher.update(encrypted),cipher.final()]);}catch{throw Error('AUTHENTICATION_FAILED');}
 let batch:Batch;try{batch=JSON.parse(plain.toString('utf8'));}catch{throw Error('INVALID_BATCH');}
 if(batch.device!==e.device||batch.seq!==e.seq||batch.version!==1||!Array.isArray(batch.operations))throw Error('INVALID_BATCH_HEADER');return batch;
}
