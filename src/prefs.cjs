const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const DEFAULT_CHANNELS = Object.freeze({feedback:false,sessionLog:false,inventory:false,productAnalytics:false,productExport:false});
const keys = Object.keys(DEFAULT_CHANNELS);
function validChannels(c) { return !!c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === keys.length && keys.every(k => Object.hasOwn(c,k) && typeof c[k] === 'boolean'); }
const LOCK_WAIT_MS = 1000;
const LOCK_STALE_MS = 10000;
const sleepSync = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms); } catch {} };
// A second writer waits briefly instead of failing: contention means "retry", not "prefs broken".
// A lock older than LOCK_STALE_MS is treated as left behind by a crashed process and reclaimed.
function acquireLock(lock) {
 const deadline=Date.now()+LOCK_WAIT_MS;
 for (;;) {
  try { return fs.openSync(lock,'wx',0o600); }
  catch(e) {
   if (e.code !== 'EEXIST') { const failed=new Error('Cannot create preference lock'); failed.code='PREFS_WRITE_FAILED'; throw failed; }
   try { if (Date.now()-fs.statSync(lock).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lock); continue; } } catch {}
   if (Date.now() >= deadline) { const busy=new Error('Another save is in progress'); busy.code='PREFS_BUSY'; throw busy; }
   sleepSync(25);
  }
 }
}
function readPrefsSync(dir) {
 const fallback = error => ({version:1,updatedAt:null,channels:{...DEFAULT_CHANNELS},error});
 if (!dir || typeof dir !== 'string') return fallback('PROFILE_DIR_UNAVAILABLE');
 try {
  const v=JSON.parse(fs.readFileSync(path.join(dir,'privacy-mode','prefs.json'),'utf8'));
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== 'channels,updatedAt,version' || v.version !== 1 || typeof v.updatedAt !== 'string' || !v.updatedAt || !validChannels(v.channels)) return fallback('INVALID_PREFS');
  return {...v,error:null};
 } catch(e) { return fallback(e.code === 'ENOENT' ? null : 'INVALID_PREFS'); }
}
async function writePrefs(dir, channels, expectedUpdatedAt) {
 if (!validChannels(channels)) { const e=new Error('Invalid channels'); e.code='INVALID_CHANNEL'; throw e; }
 const folder=path.join(dir,'privacy-mode'); fs.mkdirSync(folder,{recursive:true,mode:0o700}); fs.chmodSync(folder,0o700);
 // Exclusive lock serializes CAS across processes; failures never replace prefs.
 const lock=path.join(folder,'.prefs.lock'); const fd=acquireLock(lock);
 let temp;
 try {
  const current=readPrefsSync(dir);
  if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== current.updatedAt) { const e=new Error('Preferences changed'); e.code='PREFS_CONFLICT'; throw e; }
  const updatedAt=new Date(Math.max(Date.now(),Date.parse(current.updatedAt)||0)+1).toISOString();
  const value={version:1,updatedAt,channels:{...channels}};
  temp=path.join(folder,`.prefs-${crypto.randomBytes(12).toString('hex')}.tmp`);
  const out=fs.openSync(temp,'wx',0o600);
  try { fs.writeFileSync(out,JSON.stringify(value)+'\n'); fs.fsyncSync(out); } finally { fs.closeSync(out); }
  fs.renameSync(temp,path.join(folder,'prefs.json')); temp=null;
  const d=fs.openSync(folder,'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); }
  return value;
 } finally { if(temp) { try { fs.unlinkSync(temp); } catch {} } fs.closeSync(fd); fs.unlinkSync(lock); }
}
module.exports={DEFAULT_CHANNELS,validChannels,readPrefsSync,writePrefs};
