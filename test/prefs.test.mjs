import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPrefsSync, writePrefs, DEFAULT_CHANNELS } from '../src/prefs.mjs';
const fresh = () => mkdtemp(join(tmpdir(),'privacy-prefs-'));
test('strict preferences, permissions and CAS', async () => {
 const dir=await fresh(); assert.equal(readPrefsSync(dir).error,null);
 const saved=await writePrefs(dir,{...DEFAULT_CHANNELS,feedback:true});
 assert.equal((await stat(join(dir,'privacy-mode','prefs.json'))).mode & 0o777,0o600);
 await assert.rejects(writePrefs(dir,DEFAULT_CHANNELS,'wrong'),{code:'PREFS_CONFLICT'});
 assert.deepEqual(readPrefsSync(dir).channels,saved.channels);
 for (const data of ['{',JSON.stringify({version:1,updatedAt:'x',channels:{}}),JSON.stringify({...saved,extra:true})]) {
  await writeFile(join(dir,'privacy-mode','prefs.json'),data); assert.ok(readPrefsSync(dir).error); assert.deepEqual(readPrefsSync(dir).channels,DEFAULT_CHANNELS);
 }
});
test('failed write leaves previous file intact',async()=>{
 const dir=await fresh(); await writePrefs(dir,DEFAULT_CHANNELS); const file=join(dir,'privacy-mode','prefs.json'); const before=await readFile(file,'utf8');
 await assert.rejects(writePrefs(dir,{...DEFAULT_CHANNELS,unknown:true})); assert.equal(await readFile(file,'utf8'),before);
});
