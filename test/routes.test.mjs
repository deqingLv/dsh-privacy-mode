import test from 'node:test';
import assert from 'node:assert/strict';
import {registerRoutes} from '../src/routes.mjs';
import {DEFAULT_CHANNELS} from '../src/prefs.mjs';
test('route validates requests and saves without touching loader',async()=>{
 let route, calls=0; const ctx={get:()=>({fetch:{register:r=>route=r}})};
 const service={status:()=>({ok:true}),save:async(c,version)=>{calls++; if(version==='stale') {const e=new Error();e.code='PREFS_CONFLICT';throw e;} if(version==='busy') {const e=new Error();e.code='PREFS_BUSY';throw e;} return {saved:c};}};
 assert.equal(registerRoutes(ctx,service),true); assert.deepEqual(route.methods,['GET','POST']); assert.equal(route.requestBody,'buffered');
 const request=body=>new Request('http://localhost/api/privacy-mode/settings',{method:'POST',body:JSON.stringify(body)});
 assert.equal((await route.fetch(request({channels:{...DEFAULT_CHANNELS,extra:false}}))).status,400);
 assert.equal((await route.fetch(request({channels:DEFAULT_CHANNELS,expectedUpdatedAt:'stale'}))).status,409);
 assert.equal((await route.fetch(request({channels:DEFAULT_CHANNELS,expectedUpdatedAt:'busy'}))).status,409);
 assert.equal((await route.fetch(request({channels:DEFAULT_CHANNELS}))).status,200); assert.equal(calls,3);
 assert.deepEqual(await (await route.fetch(new Request('http://localhost/api/privacy-mode/settings'))).json(),{ok:true});
 assert.equal(registerRoutes({get:()=>undefined},service),false);
});
