import {webSessionCrypto} from './modules/packages/platform/web-crypto.js';
import {base64} from './modules/packages/platform/bytes.js';
const output=document.querySelector('#result');
document.querySelector('#crypto').onclick=async()=>{
 try {const key=base64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const adapter=await webSessionCrypto('probe',key);const batch={version:1,device:'probe',seq:1,operations:[],checksum:'crypto-only-probe'};
 const recovered=await adapter.open(await adapter.seal(batch));if(JSON.stringify(recovered)!==JSON.stringify(batch))throw Error('ROUNDTRIP_FAILED');
 output.textContent='Web Crypto 往返通过。此检查不代表账务或原生设备验收通过。';}catch(error){output.textContent='检查失败：'+error.message;}
};
document.querySelector('#sqlite').onclick=async()=>{
 if(!window.__TAURI__?.core?.invoke){output.textContent='当前不是 Tauri 原生运行环境，SQLite 未验证。';return;}
 try{const r=await window.__TAURI__.core.invoke('run_probe');output.textContent=JSON.stringify(r,null,2);}catch(error){output.textContent='原生检查失败：'+String(error);}
};
