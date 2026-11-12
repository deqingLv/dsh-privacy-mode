import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { TARGETS, SUPPORTED_DSH } from '../src/policy.mjs';
const cli=fileURLToPath(new URL('../bin/check.mjs',import.meta.url));
const invoke=args=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:10000});
test('CLI accepts safe snapshot, does not change file',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'privacy-check-'));const file=join(dir,'snapshot.json');
 const rows=TARGETS.map(t=>({id:t.id,name:t.name,...t.disabled?{disabled:true}:{config:{[t.key]:t.value}}}));
 const text=JSON.stringify(rows);await writeFile(file,text);
 const r=invoke(['--config',file,'--dsh-version',SUPPORTED_DSH]);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).ok,true);
 assert.equal(await readFile(file,'utf8'),text);
});
test('CLI version and incomplete snapshots fail with status 2',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'privacy-check-'));const file=join(dir,'snapshot.json');await writeFile(file,'[]');
 const r=invoke(['--config',file,'--dsh-version','999.0.0']);assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).ok,false);
});
test('CLI unknown, duplicate and missing options rejected',()=>{
 for(const args of [['--no-tracking'],['--config'],['--desktop','--desktop'],['--dsh-version','x','--dsh-version','y']])assert.equal(invoke(args).status,1);
});
test('invalid YAML never exposes sensitive parser excerpts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'privacy-check-'));const file=join(dir,'snapshot.yml');await writeFile(file,'secret-synthetic-test: [broken');
 const r=invoke(['--config',file,'--dsh-version',SUPPORTED_DSH]);assert.equal(r.status,1);assert.ok(!r.stderr.includes('secret-synthetic-test'));
});
test('!!js does not execute even when checking unsafe expressions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'privacy-check-'));const file=join(dir,'snapshot.yml');
 await writeFile(file,'- id: session-log-deepseek\n  name: "@deepseek-ai/dsh-session-log-deepseek"\n  config:\n    enabled: !!js "throw new Error(\'executed-synthetic\')"\n');
 const r=invoke(['--config',file,'--dsh-version',SUPPORTED_DSH]);assert.equal(r.status,2);assert.ok(!r.stderr.includes('executed-synthetic'));
});
