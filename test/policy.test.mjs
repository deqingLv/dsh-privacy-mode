import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { TARGETS, SUPPORTED_DSH, auditEntries } from '../src/policy.mjs';
import { apply as sink } from '../src/product-sink.mjs';

const valid = () => TARGETS.map(t => ({ id: t.id, name: t.name, ...(t.disabled ? { disabled: true } : { config: { [t.key]: t.value } }) })).concat([{ id: 'privacy-mode-product-sink', name: 'dsh-privacy-mode/product-sink' }]);
const audit = rows => auditEntries(rows, { runtimeVersion: SUPPORTED_DSH, desktop: true });

test('all known channels configured off', () => assert.equal(audit(valid()).ok, true));
test('reject unverified version instead of claiming compatible', () => assert.equal(auditEntries(valid(), { runtimeVersion: '0.2.2-rc.1', desktop: true }).ok, false));
for (const target of TARGETS) {
  test(`detect higher-precedence override: ${target.id}`, () => {
    const rows = valid(); const row = rows.find(r => r.id === target.id);
    if (target.disabled) row.disabled = false; else row.config[target.key] = target.value === false ? true : 'FEEDBACK_ONLY';
    assert.equal(audit(rows).ok, false);
  });
  test(`do not confuse same id different package: ${target.id}`, () => {
    const rows = valid(); rows.find(r => r.id === target.id).name = 'untrusted-package';
    assert.equal(audit(rows).ok, false);
  });
}
test('missing and duplicate rows fail explicitly', () => {
  assert.equal(audit(valid().slice(1)).ok, false);
  assert.equal(audit([...valid(), valid()[0]]).ok, false);
});
test('extra official exporter under another id detected', () => {
  assert.equal(audit([...valid(), { id: 'other-exporter', name: TARGETS[0].name }]).ok, false);
});
test('unresolved expression is not silently treated as disabled', () => {
  const rows = valid(); rows[1].config.enabled = { __jsExpr: 'false' }; assert.equal(audit(rows).ok, false);
});
test('nested groups audited without mutating caller', () => {
  const rows = [{ id: 'nested', group: true, config: valid() }]; const before = structuredClone(rows);
  assert.equal(audit(rows).ok, true); assert.deepEqual(rows, before);
});
test('malformed and cyclic entry trees rejected', () => {
  assert.throws(() => audit(null)); assert.throws(() => audit([null]));
  const rows = []; rows.push({ group: true, config: rows }); assert.throws(() => audit(rows));
});
test('web can omit desktop-specific channels', () => {
  assert.equal(auditEntries(valid().slice(0, 3), { runtimeVersion: SUPPORTED_DSH, desktop: false }).ok, true);
});
test('sink stores no record, opens no transport and unregisters via owner', () => {
  let service; const ctx = { provide(name, value) { assert.equal(name, 'productTelemetry'); service = value; } };
  sink(ctx); for (let i = 0; i < 10; i++) assert.equal(service.emit({ secret: 'synthetic' }), undefined);
  assert.deepEqual(Object.keys(service).sort(), ['emit', 'privacyModeSink']); assert.ok(Object.isFrozen(service));
  assert.throws(() => sink(ctx, { endpoint: 'https://invalid.test' }));
});
test('shipped bundle disables defaults; no install-time script or executable expressions except upstream version/profile', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml'); assert.equal(manifest.engines.dsh, SUPPORTED_DSH);
  assert.equal(manifest.scripts.postinstall, undefined); assert.equal(manifest.scripts.prepare, undefined);
  const schema = yaml.JSON_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: data => ({ __jsExpr: data }) }));
  const patch = yaml.load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), { schema });
  assert.deepEqual(patch.filter(p => p.id).map(p => p.id), TARGETS.map(t => t.id));
  assert.equal(audit(patch.filter(p => p.id).concat(patch.at(-1).insert)).ok, false, 'offline expressions remain unresolved');
});

for (let mask=0;mask<32;mask++) test(`selection combination ${mask}`,()=>{
 const keys=['feedback','sessionLog','inventory','productExport','productAnalytics'];
 const expected=Object.fromEntries(keys.map((key,i)=>[key,Boolean(mask & (1<<i))]));
 const rows=valid();
 rows[0].config.mode=expected.feedback?'FEEDBACK_ONLY':'DISABLED';
 rows[1].config.enabled=expected.sessionLog; rows[2].config.enabled=expected.inventory;
 rows[3].disabled=!expected.productExport; rows[4].config.enabled=expected.productAnalytics;
 rows[5].disabled=expected.productExport;
 const report=auditEntries(rows,{runtimeVersion:SUPPORTED_DSH,desktop:true,expected});
 assert.equal(report.ok,true); assert.ok(report.checks.every(c=>c.status==='as-selected'));
 rows[1].config.enabled=!expected.sessionLog;
 assert.ok(auditEntries(rows,{runtimeVersion:SUPPORTED_DSH,desktop:true,expected}).issues.some(i=>i.code==='PRIVACY_OVERRIDE_OR_UNRESOLVED'));
});

test('unresolved boot expressions are reported, not called an override', () => {
  const rows = valid();
  rows[0].config.mode = { __jsExpr: 'true' };
  rows[5].disabled = { __jsExpr: 'false' };
  const report = audit(rows);
  assert.equal(report.ok, false);
  assert.deepEqual(report.issues.map(i => i.code).sort(), ['EXPRESSION_REQUIRES_RUNTIME', 'EXPRESSION_REQUIRES_RUNTIME']);
  assert.ok(report.checks.some(c => c.status === 'unresolved-expression'));
  assert.ok(!report.issues.some(i => i.code === 'MISSING_PRIVACY_SINK'));
});
