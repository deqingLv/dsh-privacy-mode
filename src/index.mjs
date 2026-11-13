import { auditEntries } from './policy.mjs';
import { bootPolicy } from './boot-policy.mjs';
import { readPrefsSync, writePrefs } from './prefs.mjs';
import { registerRoutes } from './routes.mjs';
import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot';

/**
 * Compare two channel maps without assuming the same key order.
 * @param left - one channel map.
 * @param right - the other channel map.
 * @returns whether every channel agrees.
 */
function sameChannels(left, right) {
	const keys = Object.keys(left);
	return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

/**
 * Project one loader entry into the flat row the audit understands, resolving
 * `!!js` values through the entry itself. A row whose expressions cannot be
 * evaluated keeps its raw values: an unresolved value is reported, never
 * assumed safe.
 * @param entry - the loader entry.
 * @returns the audit row.
 */
function auditRow(entry) {
	const row = entry.options;
	const resolve = (value) => (value && typeof value === 'object' && typeof value.__jsExpr === 'string' ? entry.evaluate(value.__jsExpr) : value);
	try {
		return {
			...row,
			disabled: resolve(row.disabled),
			config: row.group ? [] : row.config && Object.fromEntries(Object.entries(row.config).map(([key, value]) => [key, resolve(value)]))
		};
	} catch {
		return { ...row, config: row.group ? [] : row.config };
	}
}

/**
 * Install the privacy guard: freeze this boot's selection, publish the status
 * service and the settings route, then report issues without failing the boot.
 * @param ctx - the Cordis context.
 * @param config - must be empty; the selection lives in the profile's preferences.
 */
export function apply(ctx, config = {}) {
	if (config && Object.keys(config).length) throw new Error('dsh-privacy-mode accepts no options');
	const applied = bootPolicy(ctx);
	let routeAvailable = true;

	const status = () => {
		const rows = [...ctx.loader.entries()].map(auditRow);
		const policy = auditEntries(rows, {
			runtimeVersion: getDshRuntimeVersion(),
			desktop: ctx.get('profileContext')?.name === 'desktop',
			expected: applied.channels
		});
		const saved = readPrefsSync(applied.dir);
		const telemetry = ctx.get('sessionTelemetry');
		const analytics = ctx.get('productAnalytics');
		const live = {
			feedbackSharing: telemetry?.sharing?.mode ?? telemetry?.sharing ?? 'not-mounted',
			productAnalyticsEnabled: typeof analytics?.enabled === 'function' ? analytics.enabled() : 'not-mounted',
			productSink: ctx.get('productTelemetry')?.privacyModeSink === true
		};
		const issues = [...policy.issues];
		if (applied.error) issues.push({ code: applied.error, target: 'boot-policy' });
		if (saved.error) issues.push({ code: saved.error, target: 'saved' });
		if (!routeAvailable) issues.push({ code: 'ROUTE_UNAVAILABLE', target: 'connection' });
		return { policy, live, saved, applied, pendingRestart: !sameChannels(saved.channels, applied.channels), issues, guarantee: policy.guarantee };
	};

	const save = async (channels, expectedUpdatedAt) => {
		const saved = await writePrefs(applied.dir, channels, expectedUpdatedAt);
		return { saved, applied, pendingRestart: !sameChannels(saved.channels, applied.channels) };
	};

	const service = Object.freeze({ status, save });
	ctx.provide('privacyMode', service);
	routeAvailable = registerRoutes(ctx, service);
	const report = status();
	if (report.issues.length) ctx.logger?.warn?.(`Privacy mode issues: ${report.issues.map((issue) => issue.code).join(', ')}`);
}

export default { name: 'privacy-mode', inject: ['loader'], apply };
