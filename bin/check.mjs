#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { auditEntries, flattenEntries, isExpr } from '../src/policy.mjs';

// Offline, read-only: consumes a composed `dsh --dump-config` output. It never
// spawns dsh, initializes profiles, reads credentials or evaluates !!js code.
const expr = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: data => ({ __jsExpr: data }) });
const schema = yaml.JSON_SCHEMA.extend(expr);
const require_ = createRequire(import.meta.url);
const FIELD = { 'session-telemetry-otel': 'mode', 'session-log-deepseek': 'enabled', 'plugin-package-inventory-deepseek': 'enabled', 'product-analytics': 'enabled' };
// Only this bundle's own boot snapshot is resolved, and only from the given profile directory:
// no other !!js expression in the dump is ever evaluated.
async function resolveSelection(entries, profileDir, desktop) {
  const { readPrefsSync } = require_('../src/prefs.cjs');
  const saved = readPrefsSync(profileDir);
  if (saved.error) throw new Error('Invalid profile preferences');
  const channels = saved.channels;
  const patch = yaml.load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), { schema });
  const canonical = new Map(patch.flatMap(row => row.insert ?? [row]).map(row => [row.id, row]));
  const matches = (actual, known) => isExpr(actual) && isExpr(known)
    && Object.keys(actual).length === 1 && actual.__jsExpr === known.__jsExpr;
  const value = { 'session-telemetry-otel': channels.feedback ? 'FEEDBACK_ONLY' : 'DISABLED', 'session-log-deepseek': channels.sessionLog, 'plugin-package-inventory-deepseek': channels.inventory, 'product-analytics': channels.productAnalytics };
  for (const row of flattenEntries(entries)) {
    const known = canonical.get(row.id);
    if (!known || row.name !== known.name) continue;
    const field = FIELD[row.id];
    if (field && matches(row.config?.[field], known.config?.[field])) row.config[field] = value[row.id];
    if (matches(row.disabled, known.disabled)) {
      if (row.id === 'desktop-product-telemetry') row.disabled = !desktop || !channels.productExport;
      else if (row.id === 'privacy-mode-product-sink') row.disabled = !desktop || channels.productExport;
      else if (row.id === 'product-analytics') row.disabled = !desktop;
    }
  }
  return channels;
}
const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('Usage: dsh-privacy-mode --config <composed-config.yml> --dsh-version <version> [--desktop] [--profile-dir <dir>]\nReads a DSH --dump-config snapshot. --profile-dir resolves this bundle\'s own boot expressions against that profile\'s saved preferences; without it those five values stay unresolved and are reported as EXPRESSION_REQUIRES_RUNTIME. Exit 0=known configuration checks pass; 2=unsafe/unverified; 1=invalid input. Does not prove no network traffic.');
} else {
  try {
    const options = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--desktop') { if (options.desktop) throw new Error('Duplicate --desktop'); options.desktop = true; }
      else if (arg === '--config' || arg === '--dsh-version' || arg === '--profile-dir') {
        if (options[arg] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing/duplicate ${arg}`);
        options[arg] = args[++i];
      } else throw new Error(`Unknown option ${arg}`);
    }
    if (!options['--config'] || !options['--dsh-version']) throw new Error('--config and --dsh-version are required');
    const text = await readFile(resolve(options['--config']), 'utf8');
    if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('Config snapshot too large');
    const entries = yaml.load(text, { schema });
    const expected = options['--profile-dir'] ? await resolveSelection(entries, resolve(options['--profile-dir']), !!options.desktop) : undefined;
    const report = auditEntries(entries, { runtimeVersion: options['--dsh-version'], desktop: !!options.desktop, ...(expected ? { expected } : {}) });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 2;
  } catch (_error) {
    // Do not print parser excerpts: snapshots can contain unrelated secrets.
    console.error('Privacy check failed: invalid arguments, unreadable file or malformed configuration. No configuration was changed.');
    process.exitCode = 1;
  }
}
