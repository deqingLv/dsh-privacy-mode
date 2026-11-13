const {readPrefsSync}=require('./prefs.cjs');
const BOOT_POLICY_KEY=Symbol.for('dsh-privacy-mode.boot-policy.v1');
function resolveBootPolicy(ctx) {
 const root=ctx.root;
 if (root[BOOT_POLICY_KEY]) return root[BOOT_POLICY_KEY];
 const dir=ctx.get('profileContext')?.dir;
 const prefs=readPrefsSync(dir);
 const snapshot=Object.freeze({channels:Object.freeze({...prefs.channels}),dir,error:prefs.error,loadedAt:new Date().toISOString()});
 Object.defineProperty(root,BOOT_POLICY_KEY,{value:snapshot,enumerable:false,writable:false,configurable:false});
 return snapshot;
}
module.exports={BOOT_POLICY_KEY,resolveBootPolicy};
