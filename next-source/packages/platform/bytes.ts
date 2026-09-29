export const utf8=(text:string)=>new TextEncoder().encode(text);
export const text=(bytes:Uint8Array)=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
export function base64(bytes:Uint8Array):string {
 let s='';for(const byte of bytes)s+=String.fromCharCode(byte);return btoa(s);
}
export function unbase64(value:unknown,length?:number):Uint8Array {
 if(typeof value!=='string'||!value||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw Error('INVALID_ENVELOPE');
 const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
 if(base64(bytes)!==value||(length!==undefined&&bytes.length!==length))throw Error('INVALID_ENVELOPE');return bytes;
}
export function concat(parts:Uint8Array[]):Uint8Array {
 const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){result.set(p,offset);offset+=p.length;}return result;
}
