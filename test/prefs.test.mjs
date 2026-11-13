import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, stat, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readPrefsSync, writePrefs, DEFAULT_CHANNELS } from '../src/prefs.mjs';
const fresh = () => mkdtemp(join(tmpdir(),'privacy-prefs-'));
test('strict preferences, permissions and CAS', async () => {
 const dir=await fresh(); assert.equal(readPrefsSync(dir).error,null);
 const saved=await writePrefs(dir,{...DEFAULT_CHANNELS,feedback:true});
 assert.equal((await stat(join(dir,'privacy-mode','prefs.json'))).mode & 0o777,0o600);
 assert.equal((await stat(join(dir,'privacy-mode'))).mode & 0o777,0o700);
 await assert.rejects(writePrefs(dir,DEFAULT_CHANNELS,'wrong'),{code:'PREFS_CONFLICT'});
 assert.deepEqual(readPrefsSync(dir).channels,saved.channels);
 for (const data of ['{',JSON.stringify({version:1,updatedAt:'x',channels:{}}),JSON.stringify({...saved,extra:true})]) {
  await writeFile(join(dir,'privacy-mode','prefs.json'),data); assert.ok(readPrefsSync(dir).error); assert.deepEqual(readPrefsSync(dir).channels,DEFAULT_CHANNELS);
 }
});
for (const holder of ['',JSON.stringify({pid:process.pid,token:'live-holder'}),JSON.stringify({pid:999999,token:'old-holder'})]) {
 test(`existing lock is never reclaimed: ${holder || 'uninitialized'}`,async()=>{
  const dir=await fresh(); await writePrefs(dir,DEFAULT_CHANNELS);
  const lock=join(dir,'privacy-mode','.prefs.lock');
  await writeFile(lock,holder);
  await assert.rejects(writePrefs(dir,{...DEFAULT_CHANNELS,feedback:true}),{code:'PREFS_BUSY'});
  assert.equal(await readFile(lock,'utf8'),holder);
  assert.deepEqual(readPrefsSync(dir).channels,DEFAULT_CHANNELS);
  // Offline recovery in this isolated fixture: no writer is running.
  await unlink(lock);
  assert.equal((await writePrefs(dir,{...DEFAULT_CHANNELS,feedback:true})).channels.feedback,true);
 });
}
test('two processes saving the same revision have exactly one CAS winner',async()=>{
 const dir=await fresh(); const initial=await writePrefs(dir,DEFAULT_CHANNELS);
 const module=new URL('../src/prefs.mjs',import.meta.url).href;
 const child=async channel=>{
  const script=`import {writePrefs,DEFAULT_CHANNELS} from ${JSON.stringify(module)}; try {await writePrefs(${JSON.stringify(dir)},{...DEFAULT_CHANNELS,${channel}:true},${JSON.stringify(initial.updatedAt)}); console.log('saved');} catch(e) {console.log(e.code);}`;
  return (await promisify(execFile)(process.execPath,['--input-type=module','-e',script])).stdout.trim();
 };
 const results=await Promise.all([child('feedback'),child('sessionLog')]);
 assert.deepEqual(results.sort(),['PREFS_CONFLICT','saved']);
 const channels=readPrefsSync(dir).channels;
 assert.notEqual(channels.feedback,channels.sessionLog);
});
test('failed write leaves previous file intact',async()=>{
 const dir=await fresh(); await writePrefs(dir,DEFAULT_CHANNELS); const file=join(dir,'privacy-mode','prefs.json'); const before=await readFile(file,'utf8');
 await assert.rejects(writePrefs(dir,{...DEFAULT_CHANNELS,unknown:true})); assert.equal(await readFile(file,'utf8'),before);
});
