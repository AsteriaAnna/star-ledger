import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const seen=new Set<string>();
function visit(file:string):void {
 const full=resolve(file);if(seen.has(full))return;seen.add(full);
 const source=readFileSync(full,'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2023}}).outputText;
 const tree=ts.createSourceFile(full,js,ts.ScriptTarget.ES2023,true);
 function walk(node:ts.Node):void {
  if(ts.isIdentifier(node)&&['Buffer','process','require'].includes(node.text))throw Error(`PLATFORM_GLOBAL: ${full}: ${node.text}`);
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)){
   const path=node.moduleSpecifier.text;if(!path.startsWith('.'))throw Error(`PLATFORM_IMPORT: ${full}: ${path}`);visit(resolve(dirname(full),path));
  }
  ts.forEachChild(node,walk);
 }
 walk(tree);
}
for(const root of ['packages/platform/async-accounting.ts','packages/accounting/business.ts','packages/analytics/index.ts','packages/sync/core.ts','packages/sync/secure-core.ts','packages/sync/github.ts','packages/platform/web-crypto.ts'])visit(root);
console.log(`PLATFORM_BOUNDARY_OK (${seen.size} runtime modules)`);
