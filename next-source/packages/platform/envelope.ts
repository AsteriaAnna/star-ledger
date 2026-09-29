export const MAX_ENVELOPE=512*1024;
export type Envelope={format:1;protocol:2;ledger:string;keyId:string;device:string;seq:number;nonce:string;ciphertext:string;tag:string};
