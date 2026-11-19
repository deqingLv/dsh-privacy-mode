import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire, registerHooks } from 'node:module';
import { SUPPORTED_DSH } from '../src/policy.mjs';

// Optional bounded integration: real Cordis PUBLIC plugin/inject/provide/effect
// lifecycle, without starting a connection server, auth, loader or telemetry.
// The boot module is only a version stub. All profile reads use owned temp dirs.
// Run with DSH_TEST_RUNTIME pointing at an existing runtime's node_modules.
const runtime = process.env.DSH_TEST_RUNTIME;
const skip = !runtime && 'Set DSH_TEST_RUNTIME to run the real Cordis lifecycle regression';
let Context, RegistrationService, privacy;
if (runtime) {
  const requireRuntime = createRequire(resolve(runtime, 'package.json'));
  ({ Context } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/cordis')).href));
  const { Service } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/cordis')).href);
  registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@deepseek-ai/dsh-app-boot') return {
      url: `data:text/javascript,${encodeURIComponent(`export const getDshRuntimeVersion = () => ${JSON.stringify(SUPPORTED_DSH)};`)}`,
      shortCircuit: true
    };
    return next(specifier, context);
  } });
  privacy = await import('../src/index.mjs');
  // Installed rc.5 connection's fetch getter and owner.effect registration
  // contract. Constructor, auth/server and syntax validation are stand-ins.
  RegistrationService = class extends Service {
    fetchRoutes = new Map();
    constructor(ctx) { super(ctx, 'connection'); }
    get fetch() {
      const owner = this.ctx;
      return { register: route => this.registerFetchRoute(owner, route) };
    }
    registerFetchRoute(owner, route) {
      const registered = { methods: new Set(route.methods), requestBody: route.requestBody, fetch: route.fetch };
      return owner.effect(() => {
        if (this.fetchRoutes.has(route.path)) throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} is already registered`);
        this.fetchRoutes.set(route.path, registered);
        return () => { this.fetchRoutes.delete(route.path); };
      }, `client-connection: ${route.path} Fetch route`);
    }
  };
}
const settle = async () => { await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); };
async function fixture(t, early = false) {
  const root = new Context(), errors = [];
  const dir = await mkdtemp(join(tmpdir(), 'privacy-route-lifecycle-'));
  root.provide('profileContext', { name: 'desktop', dir });
  root.provide('loader', { entries() { return []; } });
  root.logger.warn = () => {};
  root.logger.error = error => errors.push(error instanceof Error ? error.message : String(error));
  let provider, connection;
  const supply = async existing => {
    provider = await root.plugin(ctx => {
      connection = existing ?? new RegistrationService(ctx);
      if (existing) ctx.provide('connection', existing);
    });
    await settle(); return connection;
  };
  const withdraw = async () => { await provider.dispose(); await settle(); };
  if (early) await supply();
  const plugin = await root.plugin(privacy.default); await settle();
  t.after(async () => { await root.fiber.dispose(); await settle(); assert.deepEqual(errors, [], 'No dependency failure or duplicate route registration'); });
  const status = () => root.get('privacyMode')?.status();
  const unavailable = () => status().issues.some(issue => issue.code === 'ROUTE_UNAVAILABLE');
  const get = async c => {
    const route = c.fetchRoutes.get('/api/privacy-mode/settings');
    assert.ok(route, 'Settings route is registered');
    assert.deepEqual([...route.methods], ['GET', 'POST']);
    assert.equal(route.requestBody, 'buffered');
    return route.fetch(new Request('http://owned.invalid/api/privacy-mode/settings'));
  };
  return { root, plugin, supply, withdraw, status, unavailable, get, get connection() { return connection; } };
}

for (const early of [true, false]) test(`real Cordis ${early ? 'existing' : 'late'} connection withdrawal releases routes and fresh provision restores GET`, { skip }, async t => {
  const f = await fixture(t, early);
  if (!early) assert.equal(f.unavailable(), true, 'Waiting for connection is not available');
  const old = early ? f.connection : await f.supply();
  const initial = await f.get(old); assert.equal(initial.status, 200);
  assert.equal((await initial.json()).issues.some(issue => issue.code === 'ROUTE_UNAVAILABLE'), false);
  assert.equal(old.fetchRoutes.size, 1);
  await f.withdraw(); assert.equal(old.fetchRoutes.size, 0); assert.equal(f.unavailable(), true);
  const fresh = await f.supply(); assert.notEqual(fresh, old); assert.equal((await f.get(fresh)).status, 200);
  assert.equal(old.fetchRoutes.size, 0); assert.equal(f.unavailable(), false);
  await f.plugin.dispose(); await settle();
  assert.equal(old.fetchRoutes.size, 0); assert.equal(fresh.fetchRoutes.size, 0); assert.equal(f.status(), undefined);
});

test('real Cordis same connection object can be withdrawn and re-provided without duplicate registration', { skip }, async t => {
  const f = await fixture(t), connection = await f.supply();
  assert.equal((await f.get(connection)).status, 200);
  await f.withdraw(); assert.equal(connection.fetchRoutes.size, 0); assert.equal(f.unavailable(), true);
  await f.supply(connection); assert.equal(connection.fetchRoutes.size, 1); assert.equal((await f.get(connection)).status, 200);
  assert.equal(f.unavailable(), false);
  await f.plugin.dispose(); await settle(); assert.equal(connection.fetchRoutes.size, 0); assert.equal(f.status(), undefined);
});

test('real Cordis privacy disposal before a late connection cannot install an orphan route', { skip }, async t => {
  const f = await fixture(t); assert.equal(f.unavailable(), true);
  await f.plugin.dispose(); await settle();
  const connection = await f.supply();
  assert.equal(connection.fetchRoutes.size, 0); assert.equal(f.status(), undefined);
});
