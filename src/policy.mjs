export const SUPPORTED_DSH = '0.2.1-rc.5';
export const TARGETS = Object.freeze([
  { id: 'session-telemetry-otel', name: '@deepseek-ai/dsh-session-telemetry-otel', key: 'mode', value: 'DISABLED', label: '反馈会话遥测' },
  { id: 'session-log-deepseek', name: '@deepseek-ai/dsh-session-log-deepseek', key: 'enabled', value: false, label: '模型请求附带 Session Log' },
  { id: 'plugin-package-inventory-deepseek', name: '@deepseek-ai/dsh-plugin-package-inventory-deepseek', key: 'enabled', value: false, label: '模型请求附带插件包清单' },
  { id: 'desktop-product-telemetry', name: '@deepseek-ai/dsh-host-product-telemetry-otel', disabled: true, label: '桌面产品埋点导出器' },
  { id: 'product-analytics', name: '@deepseek-ai/dsh-client-product-analytics', key: 'enabled', value: false, label: '桌面产品埋点采集' },
]);

export function flattenEntries(entries, ancestors = new Set()) {
  if (!Array.isArray(entries)) throw new TypeError('Expected a DSH entry array');
  if (ancestors.has(entries)) throw new TypeError('Cyclic entry tree');
  const seen = new Set(ancestors).add(entries);
  return entries.flatMap(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('Invalid entry');
    return [row, ...(row.group && Array.isArray(row.config) ? flattenEntries(row.config, seen) : [])];
  });
}

export const isExpr = value => !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.__jsExpr === 'string';
// Does not evaluate arbitrary !!js expressions. An unresolved value is NOT proof of privacy.
export function auditEntries(entries, { runtimeVersion, desktop = false, expected = { feedback:false, sessionLog:false, inventory:false, productAnalytics:false, productExport:false } } = {}) {
  const rows = flattenEntries(entries);
  const issues = [];
  const checks = [];
  if (runtimeVersion !== SUPPORTED_DSH) issues.push({ code: 'UNVERIFIED_VERSION', target: 'runtime' });
  const selected = [expected.feedback, expected.sessionLog, expected.inventory, expected.productExport, expected.productAnalytics];
  for (const [index, rule] of TARGETS.entries()) {
    const matches = rows.filter(row => row.id === rule.id);
    if (!matches.length && !desktop && rule.id.startsWith('desktop-')) {
      checks.push({ id: rule.id, status: 'not-applicable' }); continue;
    }
    if (!matches.length && !desktop && rule.id === 'product-analytics') {
      checks.push({ id: rule.id, status: 'not-applicable' }); continue;
    }
    if (matches.length !== 1) {
      issues.push({ code: matches.length ? 'AMBIGUOUS_TARGET' : 'MISSING_TARGET', target: rule.id });
      checks.push({ id: rule.id, status: 'unverified' }); continue;
    }
    const row = matches[0];
    if (row.name !== rule.name) {
      issues.push({ code: 'MODULE_IDENTITY_MISMATCH', target: rule.id });
      checks.push({ id: rule.id, status: 'unverified' }); continue;
    }
    const wanted = index === 0 ? (selected[index] ? 'FEEDBACK_ONLY' : 'DISABLED') : index === 3 ? (!desktop || !selected[index]) : selected[index];
    const actual = index === 3 ? row.disabled : row.config?.[rule.key];
    if (isExpr(actual) || isExpr(row.disabled)) {
      issues.push({ code: 'EXPRESSION_REQUIRES_RUNTIME', target: rule.id });
      checks.push({ id: rule.id, status: 'unresolved-expression', selection: selected[index] ? 'selected-on' : 'selected-off' });
      continue;
    }
    const safe = actual === wanted && (index === 3 || row.disabled !== true || !selected[index] || (!desktop && rule.id === 'product-analytics'));
    if (!safe) issues.push({ code: 'PRIVACY_OVERRIDE_OR_UNRESOLVED', target: rule.id });
    checks.push({ id: rule.id, status: safe ? 'as-selected' : 'unsafe-or-unresolved', selection: selected[index] ? 'selected-on' : 'selected-off' });
  }
  const knownNames = new Set(TARGETS.map(r => r.name));
  // Duplicate official channel instances under another id are outside the bundle's id-targeted controls.
  for (const row of rows) {
    if (knownNames.has(row.name) && !TARGETS.some(t => row.id === t.id && row.name === t.name) && row.disabled !== true) {
      issues.push({ code: 'EXTRA_OFFICIAL_CHANNEL', target: 'additional-instance' });
    }
  }
  const sink = rows.filter(row => row.id === 'privacy-mode-product-sink');
  if (desktop && sink.length === 1 && isExpr(sink[0].disabled)) {
    issues.push({ code: 'EXPRESSION_REQUIRES_RUNTIME', target: 'privacy-mode-product-sink' });
  } else if (desktop && (sink.length !== 1 || sink[0].name !== 'dsh-privacy-mode/product-sink' || Boolean(sink[0].disabled) !== Boolean(expected.productExport))) {
    issues.push({ code: 'MISSING_PRIVACY_SINK', target: 'privacy-mode-product-sink' });
  }
  return { scope: 'known-official-reporting-channels', ok: issues.length === 0, runtimeVersion, desktop, checks, issues,
    guarantee: 'configuration-audit-only; not packet capture, not an egress firewall' };
}
