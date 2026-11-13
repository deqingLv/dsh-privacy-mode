import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { TARGETS, SUPPORTED_DSH } from '../src/policy.mjs';
import { DEFAULT_CHANNELS } from '../src/prefs.mjs';
const checker = new URL('../bin/check.mjs', import.meta.url).pathname;
const expr = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: data => ({ __jsExpr: data }) });
const schema = yaml.JSON_SCHEMA.extend(expr);
async function dump(change = () => {}) {
  const patch = yaml.load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), { schema });
  const rows = patch.flatMap(row => row.insert ?? [row]);
  change(rows);
  const dir = await mkdtemp(join(tmpdir(), 'privacy-check-'));
  const file = join(dir, 'dump.yml');
  await writeFile(file, yaml.dump(rows));
  return { dir, file };
}
const run = ({file,dir}, profile = true, desktop = true) => spawnSync(process.execPath, [checker, '--config', file, '--dsh-version', SUPPORTED_DSH, ...(desktop ? ['--desktop'] : []), ...(profile ? ['--profile-dir', dir] : [])], {encoding:'utf8'});

test('an unevaluated dump is reported as unresolved, not as an override', async () => {
  const out = run(await dump(), false);
  assert.equal(out.status, 2);
  const report = JSON.parse(out.stdout);
  assert.ok(report.issues.every(i => i.code === 'EXPRESSION_REQUIRES_RUNTIME'));
});
test('--profile-dir resolves exact bundled expressions', async () => {
  const out = run(await dump());
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(JSON.parse(out.stdout).checks.filter(c => c.status === 'as-selected').length, TARGETS.length);
});
test('saved selection is checked for desktop and web without evaluating code', async () => {
  const fixture = await dump();
  await mkdir(join(fixture.dir,'privacy-mode'));
  await writeFile(join(fixture.dir,'privacy-mode','prefs.json'), JSON.stringify({version:1,updatedAt:'2026-01-01T00:00:00.000Z',channels:{...DEFAULT_CHANNELS,feedback:true,productExport:true,productAnalytics:true}}));
  for (const desktop of [true,false]) {
    const out=run(fixture,true,desktop);
    assert.equal(out.status,0,out.stdout+out.stderr);
  }
});
for (const replacement of [{__jsExpr:'true'}, {value:false}, true]) {
  test(`profile resolution preserves foreign override ${JSON.stringify(replacement)}`, async () => {
    const fixture=await dump(rows=> { rows.find(r=>r.id==='session-log-deepseek').config.enabled=replacement; });
    const out=run(fixture);
    assert.equal(out.status,2,out.stdout);
    assert.ok(JSON.parse(out.stdout).issues.some(i=>i.target==='session-log-deepseek'));
  });
}
test('unknown disabled expression and wrong module never become verified',async()=>{
  for (const change of [
    rows=>{rows.find(r=>r.id==='product-analytics').disabled={__jsExpr:'false'};},
    rows=>{rows.find(r=>r.id==='privacy-mode-product-sink').disabled={__jsExpr:'false'};},
    rows=>{rows.find(r=>r.id==='session-log-deepseek').name='other-module';}
  ]) assert.equal(run(await dump(change)).status,2);
});
test('corrupt preferences cannot produce a passing offline audit',async()=>{
  const fixture=await dump();
  await mkdir(join(fixture.dir,'privacy-mode'));
  await writeFile(join(fixture.dir,'privacy-mode','prefs.json'),'{');
  assert.equal(run(fixture).status,1);
});
