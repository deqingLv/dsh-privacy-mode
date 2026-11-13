import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootPolicy } from '../src/boot-policy.mjs';
import { writePrefs, DEFAULT_CHANNELS } from '../src/prefs.mjs';
test('one frozen snapshot per root across updates',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'privacy-boot-')); const root={}; const ctx={root,get:()=>({dir})};
 const a=bootPolicy(ctx); await writePrefs(dir,{...DEFAULT_CHANNELS,feedback:true}); assert.equal(bootPolicy(ctx),a); assert.equal(a.channels.feedback,false);
 const b=bootPolicy({...ctx,root:{}}); assert.equal(b.channels.feedback,true); assert.ok(Object.isFrozen(b.channels));
});
