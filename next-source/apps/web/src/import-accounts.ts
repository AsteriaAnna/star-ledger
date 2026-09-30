import type {MemoryStore} from './store.ts';
import type {Draft} from './importer.ts';
import {BusinessAccountingService} from '../../../packages/accounting/business.ts';
import {AccountingService} from '../../../packages/accounting/index.ts';
import {project} from '../../../packages/sync/projection.ts';
import {accountSetupGroups,allowedAccount,aliasId,aliasScope,canRemember,instrumentId,type Role} from './account-matcher.ts';
import {reviewDraft,ruleCommand,ruleValue} from './import-workflow.ts';
import {refundContext} from './refund-matcher.ts';
export function rememberAccount(store:MemoryStore,d:Draft,role:Role,id:string){
 if(!canRemember(d,role))return;
 const core=new AccountingService(store,store.state.device);
 if(ruleValue(store.entities,aliasId(d,role))?.accountId!==id)core.execute([ruleCommand(store.entities,aliasId(d,role),{...aliasScope(d,role),accountId:id})]);
 const key=instrumentId(d,role);
 if(key&&!store.entities.some(e=>e.type==='import_rules'&&e.id===key&&e.fields.value!==null))core.execute([ruleCommand(store.entities,key,{accountId:id})]);
}
export type AccountChoice={key:string;accountId:string;name:string;type:'ASSET'|'LIABILITY'};
export function configureImportAccounts(store:MemoryStore,choices:AccountChoice[],expected:number){
 if((store.state.importRevision||0)!==expected)throw Error('导入队列已变化，请重新打开账户设置');
 const snapshot=project(store.state.ops),next=structuredClone(store.state.imports||[]);
 next.forEach(d=>reviewDraft(d,snapshot.entities,snapshot.conflicts,refundContext(snapshot.entities,next)));
 const groups=accountSetupGroups(next,snapshot.entities.filter(e=>e.type==='accounts'),snapshot.entities.filter(e=>e.type==='import_rules'),snapshot.conflicts);
 const service=new BusinessAccountingService(store,store.state.device);
 const names=new Map<string,string>();for(const c of choices){if(['new','later'].includes(c.accountId))continue;if(names.has(c.accountId)&&names.get(c.accountId)!==c.name.trim())throw Error('同一账户请使用相同的显示名称');names.set(c.accountId,c.name.trim());}
 for(const choice of choices){
  if(choice.accountId==='later')continue;
  const group=groups.find(g=>g.key===choice.key);if(!group)throw Error('账户组已变化，请重新打开');
  let id=choice.accountId;
  if(id==='new'){
   id=crypto.randomUUID();service.execute({kind:'CREATE_ACCOUNT',id,name:choice.name.trim(),accountType:choice.type,openingBalance:null,openingBalanceAt:new Date().toISOString(),last4:group.descriptor?.last4||''});
  }
  if(choice.accountId!=='new'&&choice.name.trim()){const core=new AccountingService(store,store.state.device);core.execute([{action:'PATCH_FIELD',entity:{type:'accounts',id,fields:{name:choice.name.trim()}}}]);}
  const a=store.entities.find(e=>e.type==='accounts'&&e.id===id);if(!a)throw Error('请选择账户');
  for(const {index,role}of group.items){
   const d=next[index];if(!allowedAccount(d,a,role))throw Error('所选账户类型不适用于本组交易');
   d[role]=id;if(role==='account')d.accountMode='manual';else d.toMode='manual';rememberAccount(store,d,role,id);
  }
 }
 const p=project(store.state.ops),context=refundContext(p.entities,next);
 for(const d of next){reviewDraft(d,p.entities,p.conflicts,context);if(!['committed','linked','ignored','noeffect','deferred'].includes(d.workflow||''))d.selected=!d.issue;}
 store.state.imports=next;store.state.importRevision=expected+1;
}
