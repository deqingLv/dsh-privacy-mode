#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { auditEntries } from '../src/policy.mjs';

// Offline, read-only: consumes a composed `dsh --dump-config` output. It never
// spawns dsh, initializes profiles, reads credentials or evaluates !!js code.
const expr = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: data => ({ __jsExpr: data }) });
const schema = yaml.JSON_SCHEMA.extend(expr);
const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('Usage: dsh-privacy-mode --config <composed-config.yml> --dsh-version <version> [--desktop]\nReads a DSH --dump-config snapshot. Exit 0=known configuration checks pass; 2=unsafe/unverified; 1=invalid input. Does not prove no network traffic.');
} else {
  try {
    const options = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--desktop') { if (options.desktop) throw new Error('Duplicate --desktop'); options.desktop = true; }
      else if (arg === '--config' || arg === '--dsh-version') {
        if (options[arg] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing/duplicate ${arg}`);
        options[arg] = args[++i];
      } else throw new Error(`Unknown option ${arg}`);
    }
    if (!options['--config'] || !options['--dsh-version']) throw new Error('--config and --dsh-version are required');
    const text = await readFile(resolve(options['--config']), 'utf8');
    if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('Config snapshot too large');
    const entries = yaml.load(text, { schema });
    const report = auditEntries(entries, { runtimeVersion: options['--dsh-version'], desktop: !!options.desktop });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 2;
  } catch (_error) {
    // Do not print parser excerpts: snapshots can contain unrelated secrets.
    console.error('Privacy check failed: invalid arguments, unreadable file or malformed configuration. No configuration was changed.');
    process.exitCode = 1;
  }
}
