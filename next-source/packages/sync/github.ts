import {utf8,text,base64,unbase64,concat} from '../platform/bytes.ts';
const MAX_ENVELOPE=512*1024;
export type RemoteFile={path:string;sha:string};
export interface EncryptedProvider {
 healthCheck():Promise<void>;
 list():Promise<RemoteFile[]>;
 download(file:RemoteFile):Promise<string>;
 upload(path:string,content:string):Promise<void>;
}
type Transport=(url:string,init:RequestInit)=>Promise<Response>;
export class GitHubSyncProvider implements EncryptedProvider {
 private base:string;private token:string;private branch:string;private prefix:string;private transport:Transport;
 constructor(config:{owner:string;repo:string;branch:string;ledger:string;token:string},transport:Transport=(url,init)=>globalThis.fetch(url,init)) {
  if(!/^[\w.-]+$/.test(config.owner)||!/^[\w.-]+$/.test(config.repo)||!config.branch||!/^[\w-]{1,100}$/.test(config.ledger)||!config.token)throw Error('INVALID_GITHUB_CONFIG');
  this.base=`https://api.github.com/repos/${config.owner}/${config.repo}`;this.token=config.token;this.branch=config.branch;this.prefix=`ledger-sync/${config.ledger}/`;this.transport=transport;
 }
 private async request(path:string,method='GET',body?:object):Promise<Response> {
  try{return await this.transport(this.base+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${this.token}`,'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
  catch{throw Error('GITHUB_NETWORK_ERROR');}
 }
 private status(r:Response):void {if(!r.ok)throw Error(r.status===401?'GITHUB_AUTH_REQUIRED':r.status===403||r.status===429?'GITHUB_FORBIDDEN_OR_RATE_LIMITED':`GITHUB_HTTP_${r.status}`);}
 private async json(r:Response,max=8*1024*1024):Promise<any> {
  this.status(r);const reader=r.body?.getReader();if(!reader)throw Error('GITHUB_EMPTY_RESPONSE');
  const parts:Uint8Array[]=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('GITHUB_RESPONSE_TOO_LARGE');}parts.push(value);}}catch(error){if(error instanceof Error&&error.message==='GITHUB_RESPONSE_TOO_LARGE')throw error;throw Error('GITHUB_NETWORK_ERROR');}
  try{return JSON.parse(text(concat(parts)));}catch{throw Error('GITHUB_INVALID_RESPONSE');}
 }
 private checkPath(path:string):void {if(!path.startsWith(this.prefix)||!/^[\w/-]+\.json$/.test(path)||path.includes('..'))throw Error('INVALID_REMOTE_PATH');}
 private contentsPath(path:string):string {this.checkPath(path);return '/contents/'+path.split('/').map(encodeURIComponent).join('/');}
 private blob(data:any):string {
  if(data.encoding!=='base64'||typeof data.content!=='string')throw Error('GITHUB_INVALID_BLOB');
  const compact=data.content.replace(/\s/g,'');const bytes=unbase64(compact);
  if(bytes.length>MAX_ENVELOPE||base64(bytes)!==compact)throw Error('GITHUB_INVALID_BLOB');return text(bytes);
 }
 async healthCheck():Promise<void> {const data=await this.json(await this.request(''));if(data.private!==true)throw Error('PRIVATE_SYNC_REPO_REQUIRED');}
 async list():Promise<RemoteFile[]> {
  const tree=await this.json(await this.request(`/git/trees/${encodeURIComponent(this.branch)}?recursive=1`));
  if(tree.truncated!==false||!Array.isArray(tree.tree))throw Error('INCOMPLETE_REMOTE_TREE');
  const files:RemoteFile[]=[];
  for(const entry of tree.tree)if(typeof entry.path==='string'&&entry.path.startsWith(this.prefix)) {
   if(entry.type==='tree')continue;
   this.checkPath(entry.path);
   if(entry.type!=='blob'||entry.mode!=='100644'||!/^[a-f0-9]{40,64}$/.test(entry.sha)||entry.size>MAX_ENVELOPE)throw Error('INVALID_REMOTE_FILE');
   files.push({path:entry.path,sha:entry.sha});
  }
  return files.sort((a,b)=>a.path.localeCompare(b.path));
 }
 async download(file:RemoteFile):Promise<string> {
  this.checkPath(file.path);if(!/^[a-f0-9]{40,64}$/.test(file.sha))throw Error('INVALID_BLOB_SHA');
  return this.blob(await this.json(await this.request(`/git/blobs/${file.sha}`),MAX_ENVELOPE*2));
 }
 async upload(path:string,content:string):Promise<void> {
  const endpoint=this.contentsPath(path);if(utf8(content).length>MAX_ENVELOPE)throw Error('ENVELOPE_TOO_LARGE');
  const existing=await this.request(`${endpoint}?ref=${encodeURIComponent(this.branch)}`);
  if(existing.status!==404){const old=this.blob(await this.json(existing,MAX_ENVELOPE*2));if(old!==content)throw Error('REMOTE_COLLISION');return;}
  const response=await this.request(endpoint,'PUT',{message:'Append encrypted ledger batch',branch:this.branch,content:base64(utf8(content))});
  if(response.status===409||response.status===422){const check=await this.request(`${endpoint}?ref=${encodeURIComponent(this.branch)}`);if(check.ok&&this.blob(await this.json(check,MAX_ENVELOPE*2))===content)return;throw Error('GITHUB_WRITE_CONFLICT');}
  this.status(response); // No sha in request: this provider never overwrites an existing remote file.
 }
}
