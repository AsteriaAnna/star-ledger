import type {Batch} from '../domain/index.ts';
import type {SessionCrypto} from './ports.ts';
import {base64,unbase64,utf8,text,concat} from './bytes.ts';
import type {Envelope} from './envelope.ts';
// This module uses only Web APIs.
const header=(e:Envelope)=>({format:e.format,protocol:e.protocol,ledger:e.ledger,keyId:e.keyId,device:e.device,seq:e.seq});
export async function webSessionCrypto(ledger:string,recoveryKey:string,api:Crypto=globalThis.crypto):Promise<SessionCrypto> {
 if(!api?.subtle||!/^[\w-]{1,100}$/.test(ledger)||!/^[A-Za-z0-9_-]{43}$/.test(recoveryKey))throw Error('INVALID_CRYPTO_CONFIG');
 const bytes=unbase64(recoveryKey.replace(/-/g,'+').replace(/_/g,'/')+'=',32);
 const keyId=Array.from(new Uint8Array(await api.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('').slice(0,32);
 const key=await api.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);bytes.fill(0);
 return {
  async seal(batch:Batch):Promise<string> {
   const plain=utf8(JSON.stringify(batch));if(plain.length>256*1024)throw Error('BATCH_TOO_LARGE');
   const e:Envelope={format:1,protocol:2,ledger,keyId,device:batch.device,seq:batch.seq,nonce:'',ciphertext:'',tag:''};
   const iv=api.getRandomValues(new Uint8Array(12));
   const encrypted=new Uint8Array(await api.subtle.encrypt({name:'AES-GCM',iv,additionalData:utf8(JSON.stringify(header(e))),tagLength:128},key,plain));
   e.nonce=base64(iv);e.ciphertext=base64(encrypted.slice(0,-16));e.tag=base64(encrypted.slice(-16));return JSON.stringify(e);
  },
  async open(value:string):Promise<Batch> {
   if(utf8(value).length>512*1024)throw Error('ENVELOPE_TOO_LARGE');
   let e:Envelope;try{e=JSON.parse(value);}catch{throw Error('INVALID_ENVELOPE');}
   if(!e||e.format!==1||e.protocol!==2)throw Error('UNSUPPORTED_PROTOCOL');
   if(e.ledger!==ledger||e.keyId!==keyId||!/^[\w-]+$/.test(e.device)||!Number.isSafeInteger(e.seq)||e.seq<1)throw Error('WRONG_LEDGER_OR_KEY');
   const iv=unbase64(e.nonce,12),encrypted=concat([unbase64(e.ciphertext),unbase64(e.tag,16)]);
   let decoded:ArrayBuffer;
   try{decoded=await api.subtle.decrypt({name:'AES-GCM',iv,additionalData:utf8(JSON.stringify(header(e))),tagLength:128},key,encrypted);}catch{throw Error('AUTHENTICATION_FAILED');}
   let batch:Batch;try{batch=JSON.parse(text(new Uint8Array(decoded)));}catch{throw Error('INVALID_BATCH');}
   if(batch.device!==e.device||batch.seq!==e.seq||batch.version!==1||!Array.isArray(batch.operations))throw Error('INVALID_BATCH_HEADER');return batch;
  }
 };
}
