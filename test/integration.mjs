import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { registerHooks, createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { auditEntries, SUPPORTED_DSH } from '../src/policy.mjs';

const runtime = process.env.DSH_TEST_RUNTIME;
if (!runtime) throw new Error('DSH_TEST_RUNTIME must point to a prepared official runtime containing node_modules');
const anchor = resolve(runtime, 'package.json');
const requireRuntime = createRequire(anchor);
let pluginRequire = createRequire(new URL('../package.json', import.meta.url));
let pluginAnchor = new URL('../package.json', import.meta.url).href;
// Self-reference through a synthetic profile path is not resolvable before the
// tarball is installed, so the hook falls back to this repository's own files.
const pluginFiles = new Map([['dsh-privacy-mode','src/index.mjs'],['dsh-privacy-mode/boot-policy','src/boot-policy.cjs'],['dsh-privacy-mode/policy','src/policy.mjs'],['dsh-privacy-mode/product-sink','src/product-sink.mjs'],['dsh-privacy-mode/package.json','package.json']]);
const pluginRoot = new URL('../', import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@deepseek-ai/')) return next(specifier, { ...context, parentURL: pathToFileURL(anchor).href });
  if (specifier === 'dsh-privacy-mode' || specifier.startsWith('dsh-privacy-mode/')) {
    try { return next(specifier, { ...context, parentURL: pluginAnchor }); }
    catch (error) { if (!pluginFiles.has(specifier)) throw error; return { url: new URL(pluginFiles.get(specifier), pluginRoot).href, shortCircuit: true }; }
  }
  return next(specifier, context);
} });
const bootApi = await import('@deepseek-ai/dsh-app-boot');
assert.equal(bootApi.getDshRuntimeVersion(), SUPPORTED_DSH);
const { Context } = await import('@deepseek-ai/cordis');
const { default: Loader, interpolate, evaluate } = await import('@deepseek-ai/cordis-plugin-loader');
const { applyEntryPatches, entryListSchema } = await import('@deepseek-ai/cordis-plugin-include');
const productMod = await import('@deepseek-ai/dsh-host-product-telemetry-otel');
const otelMod = await import('@deepseek-ai/dsh-otel');
const sessionsMod = await import('@deepseek-ai/dsh-session');
const telemetryMod = await import('@deepseek-ai/dsh-session-telemetry-otel');
const logsMod = await import('@deepseek-ai/dsh-session-log-deepseek');
const inventoryMod = await import('@deepseek-ai/dsh-plugin-package-inventory-deepseek');

const temp = await mkdtemp(join(tmpdir(), 'dsh-privacy-verification-'));
const home = join(temp,'home'); await mkdir(home);
const dshHome = join(home,'dsh'); await mkdir(dshHome);
// Test process cannot inherit a real account, collector URL, remote hook, proxy,
// credentials environment, or a real HOME. Only install CLI gets needed PATH.
for (const key of Object.keys(process.env)) if (!['PATH','SystemRoot','TMPDIR','DSH_TEST_RUNTIME','DSH_TEST_TARBALL','DSH_TEST_PNPM','DSH_TEST_RESULT'].includes(key)) delete process.env[key];
process.env.HOME = home; process.env.DSH_HOME = dshHome;
process.env.XDG_CONFIG_HOME = join(home,'config'); process.env.DSH_CLIENT_VERSION = SUPPORTED_DSH;
// The patch stores its managed values as !!js expressions. Composition, dump and
// the offline checker all keep them unevaluated, so this test evaluates them the
// same way the loader does: a stub context exposing only profileContext.
const evalContext = dir => ({ root: {}, get: key => (key === 'profileContext' ? { name: 'desktop', dir } : undefined) });
// Unrelated official rows use helpers such as dshHomePath(); only the managed
// rows are expected to resolve here, so an unresolvable row keeps its raw form.
const evaluateRows = (dir, list) => list.map(row => { try { return interpolate(evalContext(dir), row); } catch { return row; } });
const base = yaml.load(await readFile(requireRuntime.resolve('@deepseek-ai/dsh-base/cordis.patch.yml'), 'utf8'), { schema: entryListSchema });
const web = yaml.load(await readFile(requireRuntime.resolve('@deepseek-ai/dsh-web-app/cordis.patch.yml'), 'utf8'), { schema: entryListSchema });
const patch = yaml.load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), { schema: entryListSchema });
const baseline = applyEntryPatches([], [...base,...web]);
const rows = applyEntryPatches([], [...base,...web,...patch], (...args)=>{throw new Error(args.join(' '));});
const evaluatedRows = evaluateRows(join(temp,'compose-default'), rows);
assert.ok(auditEntries(evaluatedRows,{runtimeVersion:SUPPORTED_DSH,desktop:true}).ok);
const reverted = applyEntryPatches([], [...base,...web]);
assert.deepEqual(reverted, baseline, 'No mutation of original base rows');
assert.equal(auditEntries(applyEntryPatches(evaluatedRows,[{id:'session-log-deepseek',config:{enabled:true}}]),{runtimeVersion:SUPPORTED_DSH,desktop:true}).ok,false);

let requests=[];
const server=createServer((req,res)=>{
  const chunks=[]; req.on('data',chunk=>chunks.push(chunk)); req.on('end',()=>{
    requests.push({path:req.url,bytes:Buffer.concat(chunks).length}); res.writeHead(200,{'content-type':'application/json'});res.end('{}');
  });
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const endpoint=`http://127.0.0.1:${server.address().port}/v1/logs`;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const positive=new Context();
try {
  // Actual official product exporter -> actual OTel SDK -> local HTTP collector.
  await positive.plugin(otelMod.default);
  await positive.plugin(productMod.default,{endpoint,serviceName:'synthetic-test',serviceVersion:SUPPORTED_DSH,compression:'none',maxExportBatchSize:1,maxQueueSize:8,scheduledDelayMillis:25,timeoutMillis:1000,exportTimeoutMillis:1500,shutdownTimeoutMillis:2000});
  positive.productTelemetry.emit({eventName:'synthetic-positive-control',timestamp:Date.now(),body:'synthetic',attributes:{}});
  await positive.fiber.dispose();
  assert.ok(requests.length>0,'Real official product exporter must reach local collector');
} finally { await positive.fiber.dispose(); }
const controlRequests=requests.length;
const telemetryControl = new Context();
try {
  await telemetryControl.plugin(otelMod.default);
  await telemetryControl.plugin(sessionsMod.default);
  await telemetryControl.plugin(telemetryMod.default,{mode:'FEEDBACK_ONLY',exporter:{url:endpoint,timeoutMillis:1000},processor:{scheduledDelayMillis:25,maxQueueSize:16,maxExportBatchSize:16,exportTimeoutMillis:1500},shutdownTimeoutMillis:2000,maxRequestBytes:4000000});
  const session=telemetryControl.sessions.create('synthetic-feedback-control');
  session.append('feedback/record',{text:'synthetic feedback control'});
  await telemetryControl.fiber.dispose();
  assert.ok(requests.length>controlRequests,'Real canonical feedback must reach collector when sharing is enabled');
} finally { await telemetryControl.fiber.dispose(); }
const allControlRequests=requests.length;

const profileDir=join(dshHome,'profiles','privacy-test'); await mkdir(profileDir,{recursive:true});
await writeFile(join(profileDir,'package.json'),JSON.stringify({private:true,type:'module',dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}},dependencies:{}}));
await writeFile(join(profileDir,'cordis.yml'),'[]\n'); await writeFile(join(profileDir,'cordis.patch.yml'),'[]\n');
const cli=requireRuntime.resolve('@deepseek-ai/dsh/lib/bin.js');
const env={...process.env};
// Use the existing user-provided pnpm runtime without installing/upgrading it.
const pnpm=process.env.DSH_TEST_PNPM;
if (!pnpm) throw new Error('DSH_TEST_PNPM must name an existing pnpm JS entry');
const binDir=join(temp,'bin'); await mkdir(binDir);
const pnpmWrapper=join(binDir,'pnpm');
await writeFile(pnpmWrapper,`#!/usr/bin/env node\nimport { spawnSync } from 'node:child_process';\nconst r=spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(pnpm)},...process.argv.slice(2)],{stdio:'inherit'});\nif(r.error) { console.error('pnpm test launcher failed'); process.exit(1); }\nprocess.exit(r.status??1);\n`,{mode:0o700});
env.PATH=binDir+':'+dirname(process.execPath)+':/usr/bin:/bin:/usr/sbin:/sbin';
const run=args=>{
 const result=spawnSync(process.execPath,[cli,...args],{env,cwd:temp,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
 if(result.status!==0) throw new Error(`DSH CLI failed: ${result.stderr||result.stdout}`);
 return result.stdout;
};
const tarball=process.env.DSH_TEST_TARBALL;if(!tarball)throw new Error('DSH_TEST_TARBALL required');
run(['plugin','--profile','privacy-test','add',resolve(tarball),'--ignore-scripts']);
const manifest=JSON.parse(await readFile(join(profileDir,'package.json'),'utf8'));
assert.ok(manifest.dsh.profile.bundles.includes('dsh-privacy-mode'),'Real CLI must activate installed bundle by default');
pluginRequire=createRequire(join(profileDir,'package.json'));
pluginAnchor=pathToFileURL(join(profileDir,'package.json')).href;
const dump=run(['--profile','privacy-test','--dump-config']);
// dump-config composes patch layers without booting, so !!js stays unresolved.
const composedRaw=yaml.load(dump,{schema:entryListSchema});
const composed=evaluateRows(profileDir,composedRaw);
assert.ok(auditEntries(composed,{runtimeVersion:SUPPORTED_DSH,desktop:true}).ok);
await writeFile(join(temp,'composed.yml'),yaml.dump(composed,{schema:entryListSchema}));
const checker=pluginRequire.resolve('dsh-privacy-mode/package.json');
const check=spawnSync(process.execPath,[join(dirname(checker),'bin/check.mjs'),'--config',join(temp,'composed.yml'),'--dsh-version',SUPPORTED_DSH,'--desktop'],{env,encoding:'utf8'});
assert.equal(check.status,0,check.stderr);

// Mount selected real modules from the installed tarball and official runtime.
// The full desktop composition is audited above, but is not booted: doing so
// would initialize account services/network tools unrelated to this synthetic test.
const ids=new Set(['session','deepseek-llm-api-extensions','otel','session-telemetry-otel','session-log-deepseek','plugin-package-inventory-deepseek','product-analytics','desktop-product-telemetry','privacy-mode-product-sink','privacy-mode']);
const selectedRaw=composedRaw.filter(row=>ids.has(row.id)).map(row=>({...row,config:row.id==='product-analytics'?{...row.config,appVersion:SUPPORTED_DSH}:row.id==='session-telemetry-otel'?{...row.config,exporter:{url:endpoint}}:row.config}));
const selected=evaluateRows(profileDir,selectedRaw);
const fixture=join(temp,'selected-root.yml'); await writeFile(fixture,yaml.dump(selectedRaw,{schema:entryListSchema}));
let identityReads=0;
let context;
try {
 context=await bootApi.boot('privacy-test',fixture,[],async c=>{
   c.provide('profileContext',{name:'desktop',dir:profileDir,home:dshHome});
   c.provide('deepseekAccount',{getDeviceIdentity(){identityReads++;throw new Error('Identity read forbidden in test');}});
   c.provide('agents',{get(){return undefined;},values(){return[];}});
 },pathToFileURL(runtime+'/').href);
 for(const row of selected.filter(r=>r.disabled!==true)) {
  const entry=[...context.loader.entries()].find(e=>e.options.id===row.id);
  assert.equal(entry?.fiber?.state,2,`${row.id} must genuinely activate`);
 }
 const failedGuard = new Context();
 try {
   const overridden=composed.map(row=>row.id==='product-analytics'?{...row,config:{...row.config,enabled:true}}:row);
   failedGuard.provide('loader',{entries(){return overridden.map(row=>({options:row,evaluate(expr){return evaluate(evalContext(profileDir),expr);}}));}});
   failedGuard.provide('profileContext',{name:'desktop',dir:profileDir});
   failedGuard.provide('productAnalytics',{enabled(){return true;}});
   const plugin=await import('dsh-privacy-mode');
   await failedGuard.plugin(plugin.default);
   const guarded=failedGuard.get('privacyMode');
   assert.ok(guarded,'The guard always publishes its status so an override is visible, not fatal');
   const guardStatus=guarded.status();
   assert.equal(guardStatus.policy.ok,false,'A live override must be reported');
   assert.ok(guardStatus.policy.issues.some(issue=>issue.code==='PRIVACY_OVERRIDE_OR_UNRESOLVED'),'Override issue must name the affected channel');
 } finally { await failedGuard.fiber.dispose(); }
 assert.ok(context.privacyMode.status().policy.ok);
 assert.equal(context.productAnalytics.enabled(),false);
 await context.productAnalytics.report({eventName:'send_button_click',timestamp:Date.now(),attributes:{}});
 assert.equal(identityReads,0);
 assert.equal(context.productTelemetry.privacyModeSink,true);
 assert.equal(context.sessionTelemetry.sharing,'disabled');
 assert.equal(context.sessionTelemetry.provider,undefined,'Disabled backend must not construct its reporter');
 // Saving must not hot-apply: the boot snapshot lives on the root context, so the
 // running composition keeps its frozen selection until the next cold start.
 const savedOn=await context.privacyMode.save({feedback:true,sessionLog:false,inventory:false,productAnalytics:false,productExport:false});
 assert.equal(savedOn.pendingRestart,true,'A saved change must be reported as pending a restart');
 assert.equal(savedOn.applied.channels.feedback,false,'The running boot keeps its frozen snapshot');
 assert.equal(context.sessionTelemetry.sharing,'disabled','Saving must not hot-apply the selection');
 const afterSave=context.privacyMode.status();
 assert.equal(afterSave.pendingRestart,true);
 assert.equal(afterSave.policy.ok,true,'Entries still match the frozen boot selection');
 assert.deepEqual(afterSave.saved.channels,{feedback:true,sessionLog:false,inventory:false,productAnalytics:false,productExport:false});
 const reboot=await bootApi.boot('privacy-test',fixture,[],async c=>{
   c.provide('profileContext',{name:'desktop',dir:profileDir,home:dshHome});
   c.provide('deepseekAccount',{getDeviceIdentity(){identityReads++;throw new Error('Identity read forbidden in test');}});
   c.provide('agents',{get(){return undefined;},values(){return[];}});
 },pathToFileURL(runtime+'/').href);
 try {
   assert.equal(reboot.sessionTelemetry.sharing,'feedback-only','A new boot must apply the saved selection');
   assert.equal(reboot.privacyMode.status().pendingRestart,false);
   assert.equal(reboot.privacyMode.status().policy.ok,true);
 } finally { await reboot.fiber.dispose(); }
 const restoredPrefs=await context.privacyMode.save({feedback:false,sessionLog:false,inventory:false,productAnalytics:false,productExport:false},savedOn.saved.updatedAt);
 assert.equal(restoredPrefs.pendingRestart,false,'Restoring the default selection clears the pending restart');
 assert.equal(context.privacyMode.status().pendingRestart,false);
 const session=context.sessions.create('synthetic-session');
 session.append('feedback/record',{text:'synthetic feedback remains local'});
 const prepared=await context.deepseekLlmApiExtensions.prepare({sessionId:session.id,signal:new AbortController().signal});
 assert.ok(!Object.hasOwn(prepared.fields,'dsh_session_log'));
 assert.ok(!Object.hasOwn(prepared.fields,'dsh_plugin_packages'));
 assert.equal(context.deepseekLlmApiExtensions.warnedFields.size,0,'Omission must be intentional, not preparation failure');
 await prepared.accept();
 context.productTelemetry.emit({eventName:'synthetic-direct-event',body:'synthetic'});
 // Positive control on these same official request-contribution modules.
 // Re-enable them only within the isolated test; no model request is sent.
 const logEntry=[...context.loader.entries()].find(e=>e.options.id==='session-log-deepseek');
 await logEntry.update({config:{enabled:true}},false,true);
 const inventoryEntry=[...context.loader.entries()].find(e=>e.options.id==='plugin-package-inventory-deepseek');
 await inventoryEntry.update({config:{enabled:true}},false,true);
 await context.loader.await();
 const enabledFields=await context.deepseekLlmApiExtensions.prepare({sessionId:session.id,signal:new AbortController().signal});
 assert.ok(Object.hasOwn(enabledFields.fields,'dsh_session_log'));
 assert.ok(Object.hasOwn(enabledFields.fields,'dsh_plugin_packages'));
 assert.equal(context.deepseekLlmApiExtensions.warnedFields.size,0);
 assert.equal(context.privacyMode.status().policy.ok,false,'Live status must detect a subsequent override');
 await delay(300);
 assert.equal(requests.length,allControlRequests,'Known official reporters must not send after feedback or product events');
 await context.fiber.dispose();
 assert.equal(requests.length,allControlRequests,'Cold-disabled reporters must not drain any packets on dispose');
} finally { await context?.fiber.dispose(); await new Promise(r=>server.close(r)); }

run(['plugin','--profile','privacy-test','remove','dsh-privacy-mode']);
const restored=yaml.load(run(['--profile','privacy-test','--dump-config']),{schema:entryListSchema});
assert.equal(restored.find(r=>r.id==='session-log-deepseek').config?.enabled,undefined);
assert.ok(!restored.some(r=>r.id==='privacy-mode'));
const report={passed:true,dshVersion:SUPPORTED_DSH,controls:{officialProductCollectorRequests:controlRequests,officialFeedbackCollectorRequests:allControlRequests-controlRequests,privacyCollectorRequests:0,identityReads},tests:['official native patch composition','higher-precedence override detected','real official product exporter positive control','real canonical feedback exporter positive control','real CLI tarball install/default selection','real CLI composed desktop bundle layers in custom profile','installed offline checker','selected real modules cold boot + installed privacy guard','override is reported without failing the plugin','live analytics false, no identity read','session telemetry no reporter','saved selection stays pending until the next boot','a new boot applies the saved selection','real request registry no log/inventory fields and no errors','same-module positive control restores both request fields','live override audit reports failure','feedback/product event/dispose produce no collector requests','real CLI uninstall restores lower layers'],note:'Synthetic data and local collector only. Selected official modules booted, not full Electron GUI. Does not guarantee all egress is blocked.',temporaryTestHome:temp};
const reportPath=process.env.DSH_TEST_RESULT??fileURLToPath(new URL('../TEST_RESULT.json',import.meta.url));
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
