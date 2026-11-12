import { auditEntries } from './policy.mjs';
import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot';

export function apply(ctx, config = {}) {
  if (config && Object.keys(config).length) throw new Error('dsh-privacy-mode accepts no options');
  const status = () => {
    const entries = [...ctx.loader.entries()].map(entry => entry.options);
    // entries() includes parent and child trees already; avoid flattening groups twice.
    const rows = entries.map(row => row.group ? { ...row, config: [] } : row);
    const report = auditEntries(rows, {
      runtimeVersion: getDshRuntimeVersion(),
      desktop: ctx.get('profileContext')?.name === 'desktop',
    });
    // Raw policy and observed live services are separate evidence.
    const analytics = ctx.get('productAnalytics');
    const telemetry = ctx.get('sessionTelemetry');
    const product = ctx.get('productTelemetry');
    report.live = {
      feedbackSharing: telemetry?.sharing?.mode ?? telemetry?.sharing ?? 'not-mounted',
      productAnalyticsEnabled: typeof analytics?.enabled === 'function' ? analytics.enabled() : 'not-mounted',
      productSink: product?.privacyModeSink === true,
    };
    if (report.live.productAnalyticsEnabled === true) {
      report.ok = false;
      report.issues.push({ code: 'LIVE_ANALYTICS_ENABLED', target: 'product-analytics' });
    }
    if (report.live.feedbackSharing !== 'disabled' && report.live.feedbackSharing !== 'not-mounted') {
      report.ok = false;
      report.issues.push({ code: 'LIVE_FEEDBACK_SHARING_ENABLED', target: 'session-telemetry-otel' });
    }
    return report;
  };
  // No timer, persistence, automatic mutation, network or new model-facing tool.
  // Configuration layers are authoritative. Later user overrides remain visible.
  const report = status();
  if (!report.ok) throw new Error(`dsh-privacy-mode: policy validation failed (${report.issues.map(i => `${i.code}:${i.target}`).join(', ')}). Run the offline checker; do not assume reporting is disabled.`);
  ctx.provide('privacyMode', Object.freeze({ status }));
  ctx.logger.info('Privacy defaults configured for known official channels; restart required after live installation. Cloud model/tool traffic is not blocked.');
}
export default { name: 'privacy-mode', inject: ['loader'], apply };
