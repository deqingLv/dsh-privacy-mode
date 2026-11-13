window.__ModuleLoader__.load({
	id: 'dsh-privacy-mode',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require('react');
		const { jsx, jsxs } = require('react/jsx-runtime');

		/** Dictionary namespace owned by this page. */
		const NS = 'privacy-mode.settings';
		const API = '/api/privacy-mode/settings';

		/**
		 * The five official reporting channels the Host patch can switch, in the
		 * order the page shows them. `productAnalytics` decides whether events are
		 * collected at all; `productExport` decides whether they leave the machine.
		 * @type {ReadonlyArray<{key:string}>}
		 */
		const CHANNELS = [{ key: 'feedback' }, { key: 'sessionLog' }, { key: 'inventory' }, { key: 'productAnalytics' }, { key: 'productExport' }];

		const zh = {
			title: '隐私上报',
			intro: '所有官方上报链路默认关闭。改动只影响下一次冷启动；当前会话保持现有行为。',
			statusReady: '已生效',
			statusPending: '待重启生效',
			statusIssue: '存在问题',
			reload: '重新读取',
			on: '已开启',
			off: '已关闭',
			saving: '保存中…',
			saved: '已保存，重启后生效',
			unchanged: '已保存',
			conflict: '设置已在别处修改，已重新读取最新状态',
			failed: '保存失败',
			loadFailed: '读取失败',
			issues: '审计问题',
			guarantee: '审计只核对配置，不抓包，也不是出站防火墙。',
			live: '当前运行态',
			liveFeedback: '反馈导出',
			liveAnalytics: '产品分析采集',
			liveSink: '零传输接收器',
			chFeedback: '反馈上报',
			hintFeedback: 'FEEDBACK_ONLY 会话反馈导出器。',
			chSessionLog: '会话日志上传',
			hintSessionLog: '把会话内容上传到会话日志服务。',
			chInventory: '插件清单',
			hintInventory: '上报已安装插件与版本。',
			chProductAnalytics: '产品分析采集',
			hintProductAnalytics: '采集产品事件，包括读取设备身份。',
			chProductExport: '产品分析导出',
			hintProductExport: '把已采集的产品事件发送到 OTLP 端点。'
		};
		const en = {
			title: 'Privacy reporting',
			intro: 'Every official reporting channel starts closed. A change only applies after the next cold start; the running session keeps its current behavior.',
			statusReady: 'In effect',
			statusPending: 'Restart required',
			statusIssue: 'Audit problem',
			reload: 'Reload',
			on: 'On',
			off: 'Off',
			saving: 'Saving…',
			saved: 'Saved; applies after restart',
			unchanged: 'Saved',
			conflict: 'Settings changed elsewhere; reloaded the latest state',
			failed: 'Save failed',
			loadFailed: 'Load failed',
			issues: 'Audit problems',
			guarantee: 'The audit checks configuration only. It is not packet capture and not an egress firewall.',
			live: 'Running state',
			liveFeedback: 'Feedback exporter',
			liveAnalytics: 'Analytics collection',
			liveSink: 'Zero-transport sink',
			chFeedback: 'Feedback telemetry',
			hintFeedback: 'The FEEDBACK_ONLY session feedback exporter.',
			chSessionLog: 'Session log upload',
			hintSessionLog: 'Uploads conversation content to the session-log service.',
			chInventory: 'Plugin inventory',
			hintInventory: 'Reports installed plugins and their versions.',
			chProductAnalytics: 'Product analytics',
			hintProductAnalytics: 'Collects product events, including device identity reads.',
			chProductExport: 'Product analytics export',
			hintProductExport: 'Sends collected product events to the OTLP endpoint.'
		};

		/**
		 * Read the Host status projection.
		 * @param fetchImpl - the fetch to use.
		 * @returns the status payload.
		 */
		async function readSettings(fetchImpl = fetch) {
			const response = await fetchImpl(API, { method: 'GET', headers: { accept: 'application/json' } });
			if (!response.ok) throw new Error(await failureCode(response));
			return response.json();
		}

		/**
		 * Save the five channel switches.
		 * @param fetchImpl - the fetch to use.
		 * @param channels - the complete channel map.
		 * @param expectedUpdatedAt - the revision the page started from.
		 * @returns the save receipt.
		 */
		async function saveSettings(fetchImpl, channels, expectedUpdatedAt) {
			const response = await fetchImpl(API, {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({ channels, expectedUpdatedAt })
			});
			if (!response.ok) {
				const code = await failureCode(response);
				const error = new Error(code);
				error.code = code;
				throw error;
			}
			return response.json();
		}

		/**
		 * Extract the Host error code from a failed response.
		 * @param response - the failed response.
		 * @returns the code, or the HTTP status when the body is not JSON.
		 */
		async function failureCode(response) {
			try {
				const body = await response.json();
				if (body && typeof body.code === 'string') return body.code;
			} catch {
				/* fall through to the status text */
			}
			return `HTTP ${response.status}`;
		}

		/**
		 * Build the complete channel map from the status payload.
		 * @param status - the Host status projection.
		 * @returns five booleans.
		 */
		function channelMap(status) {
			const source = status?.saved?.channels ?? status?.applied?.channels ?? {};
			return CHANNELS.reduce((next, channel) => {
				next[channel.key] = source[channel.key] === true;
				return next;
			}, {});
		}

		/**
		 * One switchable reporting channel.
		 * @param props - the row props.
		 * @returns the row element.
		 */
		function ChannelRow({ channel, enabled, busy, disabled, t, onToggle }) {
			const labelId = `privacy-mode-${channel.key}`;
			return jsxs('div', {
				className: 'sb-priv-row',
				'data-channel': channel.key,
				children: [
					jsxs('div', {
						className: 'sb-priv-copy',
						children: [
							jsx('div', { className: 'sb-priv-label', id: labelId, children: t(`ch${channel.key[0].toUpperCase()}${channel.key.slice(1)}`) }),
							jsx('div', { className: 'sb-priv-hint', children: t(`hint${channel.key[0].toUpperCase()}${channel.key.slice(1)}`) })
						]
					}),
					jsx('button', {
						type: 'button',
						role: 'switch',
						className: 'sb-priv-switch',
						'aria-checked': enabled,
						'aria-labelledby': labelId,
						'data-state': enabled ? 'on' : 'off',
						disabled: disabled || busy,
						onClick: () => onToggle(channel.key, !enabled),
						children: jsx('span', { className: 'sb-priv-knob' })
					})
				]
			});
		}

		/**
		 * The privacy reporting page.
		 * @param props - slot props; `t` is the dictionary binding.
		 * @returns the page element.
		 */
		function PrivacyPage({ t }) {
			const [status, setStatus] = React.useState(null);
			const [phase, setPhase] = React.useState('loading');
			const [busy, setBusy] = React.useState(null);
			const [notice, setNotice] = React.useState(null);
			const [error, setError] = React.useState(null);

			const load = React.useCallback(async () => {
				try {
					const next = await readSettings();
					setStatus(next);
					setPhase('ready');
					setError(null);
				} catch (failure) {
					setPhase('error');
					setError(String(failure?.message ?? failure));
				}
			}, []);

			React.useEffect(() => {
				load();
			}, [load]);

			const toggle = React.useCallback(
				async (key, value) => {
					if (!status) return;
					const channels = { ...channelMap(status), [key]: value };
					setBusy(key);
					setNotice(null);
					try {
						const receipt = await saveSettings(fetch, channels, status.saved?.updatedAt ?? null);
						setNotice(receipt?.pendingRestart === false ? t('unchanged') : t('saved'));
						await load();
					} catch (failure) {
						if (failure?.code === 'PREFS_CONFLICT') {
							setNotice(t('conflict'));
							await load();
						} else {
							setError(String(failure?.message ?? failure));
							setNotice(t('failed'));
						}
					} finally {
						setBusy(null);
					}
				},
				[status, load, t]
			);

			if (phase === 'loading') return jsx('div', { className: 'sb-priv', children: jsx('div', { className: 'sb-priv-muted', children: t('title') }) });
			if (phase === 'error')
				return jsxs('div', {
					className: 'sb-priv',
					children: [
						jsx('h3', { className: 'sb-priv-title', children: t('title') }),
						jsxs('div', { className: 'sb-priv-error', children: [t('loadFailed'), ': ', error] }),
						jsx('button', { type: 'button', className: 'sb-priv-button', onClick: load, children: t('reload') })
					]
				});

			const channels = channelMap(status);
			const pending = status?.pendingRestart === true;
			const issues = Array.isArray(status?.issues) ? status.issues : [];
			const healthy = status?.policy?.ok !== false;
			const tone = issues.length > 0 || !healthy ? 'issue' : pending ? 'pending' : 'ready';
			const toneLabel = tone === 'issue' ? t('statusIssue') : tone === 'pending' ? t('statusPending') : t('statusReady');
			const live = status?.live ?? {};

			return jsxs('div', {
				className: 'sb-priv',
				children: [
					jsxs('header', {
						className: 'sb-priv-head',
						children: [
							jsx('h3', { className: 'sb-priv-title', children: t('title') }),
							jsx('span', { className: `sb-priv-pill sb-priv-pill-${tone}`, 'data-tone': tone, children: toneLabel })
						]
					}),
					jsx('p', { className: 'sb-priv-intro', children: t('intro') }),
					jsx('div', {
						className: 'sb-priv-rows',
						children: CHANNELS.map((channel) =>
							jsx(
								ChannelRow,
								{
									channel,
									enabled: channels[channel.key] === true,
									busy: busy === channel.key,
									disabled: false,
									t,
									onToggle: toggle
								},
								channel.key
							)
						)
					}),
					notice ? jsx('div', { className: 'sb-priv-notice', role: 'status', children: notice }) : null,
					issues.length > 0
						? jsxs('div', {
								className: 'sb-priv-issues',
								children: [
									jsx('div', { className: 'sb-priv-issues-title', children: t('issues') }),
									jsx('ul', { children: issues.map((issue, index) => jsx('li', { children: `${issue.code}${issue.channel ? ` · ${issue.channel}` : ''}` }, index)) })
								]
							})
						: null,
					jsxs('div', {
						className: 'sb-priv-live',
						children: [
							jsx('div', { className: 'sb-priv-live-title', children: t('live') }),
							jsx('div', { className: 'sb-priv-live-line', children: `${t('liveFeedback')}: ${live.feedbackSharing ?? '—'}` }),
							jsx('div', { className: 'sb-priv-live-line', children: `${t('liveAnalytics')}: ${String(live.productAnalyticsEnabled ?? '—')}` }),
							jsx('div', { className: 'sb-priv-live-line', children: `${t('liveSink')}: ${String(live.productSink ?? '—')}` })
						]
					}),
					jsx('p', { className: 'sb-priv-guarantee', children: status?.guarantee ?? t('guarantee') }),
					jsx('button', { type: 'button', className: 'sb-priv-button', onClick: load, disabled: busy !== null, children: t('reload') })
				]
			});
		}

		const STYLE = `
.sb-priv{display:flex;flex-direction:column;gap:12px;padding:16px 18px;border:1px solid var(--dsw-alias-border-secondary,#e5e6eb);border-radius:12px;background:var(--dsw-alias-bg-secondary,#fff);color:var(--dsw-alias-text-primary,#1d2129);font-size:13px;line-height:20px}
.sb-priv-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.sb-priv-title{margin:0;font-size:15px;font-weight:600}
.sb-priv-pill{padding:1px 8px;border-radius:999px;font-size:12px;border:1px solid transparent}
.sb-priv-pill-ready{color:#0f7b40;background:#e8f7ee;border-color:#bfe6cf}
.sb-priv-pill-pending{color:#8a5a00;background:#fff5e6;border-color:#f5d9a8}
.sb-priv-pill-issue{color:#a8071a;background:#fff1f0;border-color:#ffccc7}
.sb-priv-intro{margin:0;color:var(--dsw-alias-text-secondary,#4e5969)}
.sb-priv-rows{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-secondary,#e5e6eb)}
.sb-priv-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-secondary,#e5e6eb)}
.sb-priv-copy{min-width:0}
.sb-priv-label{font-weight:500}
.sb-priv-hint{color:var(--dsw-alias-text-secondary,#4e5969);font-size:12px}
.sb-priv-switch{position:relative;flex:none;width:36px;height:20px;padding:0;border:0;border-radius:999px;cursor:pointer;background:#c9cdd4;transition:background .15s ease}
.sb-priv-switch[data-state="on"]{background:#1664ff}
.sb-priv-switch:disabled{opacity:.55;cursor:progress}
.sb-priv-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s ease}
.sb-priv-switch[data-state="on"] .sb-priv-knob{transform:translateX(16px)}
.sb-priv-notice{padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-tertiary,#f2f3f5);color:var(--dsw-alias-text-secondary,#4e5969)}
.sb-priv-issues{padding:8px 10px;border-radius:8px;background:#fff1f0;color:#a8071a}
.sb-priv-issues ul{margin:4px 0 0;padding-left:18px}
.sb-priv-live{display:flex;flex-direction:column;gap:2px;color:var(--dsw-alias-text-secondary,#4e5969)}
.sb-priv-live-title{font-weight:500;color:var(--dsw-alias-text-primary,#1d2129)}
.sb-priv-guarantee{margin:0;color:var(--dsw-alias-text-tertiary,#86909c);font-size:12px}
.sb-priv-button{align-self:flex-start;padding:4px 12px;border:1px solid var(--dsw-alias-border-secondary,#e5e6eb);border-radius:8px;background:var(--dsw-alias-bg-secondary,#fff);color:inherit;cursor:pointer;font:inherit}
.sb-priv-button:disabled{opacity:.55;cursor:progress}
.sb-priv-muted{color:var(--dsw-alias-text-tertiary,#86909c)}
.sb-priv-error{color:#a8071a}
`;

		/**
		 * Mount the privacy page into the Plugins settings section.
		 * @param ctx - the browser plugin context.
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'privacy-mode: dictionaries');
			ctx.effect(() => {
				const style = document.createElement('style');
				style.setAttribute('data-plugin-css', 'dsh-privacy-mode');
				style.textContent = STYLE;
				document.head.appendChild(style);
				return () => style.remove();
			}, 'privacy-mode: styles');
			ctx.effect(
				() =>
					ctx.slots.inject('plugins.item', () =>
						ctx.slots.register(
							{
								name: 'plugins.item',
								id: 'privacy-mode',
								order: 60,
								label: () => t('title'),
								locale: NS,
								inject: () => ({})
							},
							PrivacyPage
						)
					),
				'privacy-mode: page'
			);
		}

		exports.apply = apply;
		exports.inject = ['slots', 'locale'];
		exports.NS = NS;
		exports.CHANNELS = CHANNELS;
		exports.channelMap = channelMap;
		exports.readSettings = readSettings;
		exports.saveSettings = saveSettings;
		return module.exports;
	}
});
