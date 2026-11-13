import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Load the browser module the way the web shell does: capture the factory the
 * module hands to `window.__ModuleLoader__`, then run it with stub React.
 * @returns the module exports.
 */
function loadClient() {
	let factory;
	globalThis.window = { __ModuleLoader__: { load: (definition) => (factory = definition.factory) } };
	const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
	new Function('window', source)(globalThis.window);
	assert.equal(typeof factory, 'function');
	return factory((specifier) => {
		if (specifier === 'react') return {};
		if (specifier === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null };
		throw new Error(`unexpected require: ${specifier}`);
	});
}

/**
 * Build a fake plugin context that records what `apply` mounts.
 * @returns the context and its recordings.
 */
function fakeContext() {
	const dictionaries = {};
	const registrations = [];
	const effects = [];
	const ctx = {
		locale: {
			bind: () => (key) => key,
			register: (namespace, dictionary) => {
				dictionaries[namespace] = dictionary;
				return () => {};
			}
		},
		slots: {
			inject: (_name, mount) => mount(),
			register: (options, component) => {
				registrations.push({ options, component });
				return () => {};
			}
		},
		effect: (effect) => {
			effects.push(effect);
			const dispose = effect();
			return typeof dispose === 'function' ? dispose : () => {};
		}
	};
	return { ctx, dictionaries, registrations, effects };
}

/**
 * Stub the document the page injects its stylesheet into.
 * @returns the recorded style element.
 */
function fakeDocument() {
	const style = { attributes: {}, textContent: '', setAttribute: (name, value) => (style.attributes[name] = value), remove: () => {} };
	globalThis.document = { createElement: () => style, head: { appendChild: () => {} } };
	return style;
}

test('the page registers one Plugins settings tab', () => {
	const client = loadClient();
	const { ctx, registrations, dictionaries } = fakeContext();
	fakeDocument();
	client.apply(ctx);
	assert.deepEqual(client.inject, ['slots', 'locale']);
	assert.equal(registrations.length, 1);
	const { options, component } = registrations[0];
	assert.equal(options.name, 'plugins.item');
	assert.equal(options.id, 'privacy-mode');
	assert.equal(options.order, 60);
	assert.equal(options.locale, client.NS);
	assert.equal(typeof component, 'function');
	assert.ok(dictionaries[client.NS].zh.title);
	assert.ok(dictionaries[client.NS].en.title);
});

test('the style sheet is tagged for the plugin loader', () => {
	const client = loadClient();
	const { ctx, effects } = fakeContext();
	const style = fakeDocument();
	client.apply(ctx);
	assert.equal(style.attributes['data-plugin-css'], 'dsh-privacy-mode');
	assert.match(style.textContent, /\.sb-priv-switch/);
});

test('every channel has a label and a hint in both dictionaries', () => {
	const client = loadClient();
	const { ctx, dictionaries } = fakeContext();
	fakeDocument();
	client.apply(ctx);
	const cap = (key) => `${key[0].toUpperCase()}${key.slice(1)}`;
	for (const dictionary of [dictionaries[client.NS].zh, dictionaries[client.NS].en]) {
		for (const { key } of client.CHANNELS) {
			assert.equal(typeof dictionary[`ch${cap(key)}`], 'string', `ch${cap(key)}`);
			assert.equal(typeof dictionary[`hint${cap(key)}`], 'string', `hint${cap(key)}`);
		}
	}
});

test('channelMap reads the saved selection and defaults every channel to off', () => {
	const client = loadClient();
	assert.deepEqual(client.channelMap(null), {
		feedback: false,
		sessionLog: false,
		inventory: false,
		productAnalytics: false,
		productExport: false
	});
	const saved = client.channelMap({ saved: { channels: { feedback: true, productExport: true } }, applied: { channels: { sessionLog: true } } });
	assert.equal(saved.feedback, true);
	assert.equal(saved.productExport, true);
	assert.equal(saved.sessionLog, false, 'the saved selection wins over the applied one');
	const applied = client.channelMap({ applied: { channels: { inventory: true } } });
	assert.equal(applied.inventory, true);
});

test('readSettings rejects with the Host error code', async () => {
	const client = loadClient();
	const ok = await client.readSettings(async () => ({ ok: true, json: async () => ({ policy: { ok: true } }) }));
	assert.deepEqual(ok, { policy: { ok: true } });
	await assert.rejects(
		() => client.readSettings(async () => ({ ok: false, status: 500, json: async () => ({ code: 'PREFS_WRITE_FAILED' }) })),
		/PREFS_WRITE_FAILED/
	);
});

test('saveSettings posts the complete selection with the expected revision', async () => {
	const client = loadClient();
	let seen;
	const receipt = await client.saveSettings(
		async (url, init) => {
			seen = { url, init };
			return { ok: true, json: async () => ({ pendingRestart: true }) };
		},
		{ feedback: true, sessionLog: false, inventory: false, productAnalytics: false, productExport: false },
		'2026-11-13T05:00:00.000Z'
	);
	assert.deepEqual(receipt, { pendingRestart: true });
	assert.equal(seen.url, '/api/privacy-mode/settings');
	assert.equal(seen.init.method, 'POST');
	assert.deepEqual(JSON.parse(seen.init.body), {
		channels: { feedback: true, sessionLog: false, inventory: false, productAnalytics: false, productExport: false },
		expectedUpdatedAt: '2026-11-13T05:00:00.000Z'
	});
});

test('saveSettings surfaces a conflict so the page can reload', async () => {
	const client = loadClient();
	await assert.rejects(
		() =>
			client.saveSettings(
				async () => ({ ok: false, status: 409, json: async () => ({ code: 'PREFS_CONFLICT' }) }),
				{ feedback: false, sessionLog: false, inventory: false, productAnalytics: false, productExport: false },
				null
			),
		(error) => error.code === 'PREFS_CONFLICT'
	);
});

test('issueLabel names the affected target and survives a bare issue', () => {
	const client = loadClient();
	assert.equal(client.issueLabel({ code: 'PRIVACY_OVERRIDE_OR_UNRESOLVED', target: 'session-log-deepseek' }), 'PRIVACY_OVERRIDE_OR_UNRESOLVED · session-log-deepseek');
	assert.equal(client.issueLabel({ code: 'MISSING_PRIVACY_SINK', channel: 'productExport' }), 'MISSING_PRIVACY_SINK · productExport');
	assert.equal(client.issueLabel({ code: 'ROUTE_UNAVAILABLE' }), 'ROUTE_UNAVAILABLE');
	assert.equal(client.issueLabel(null), '');
});

test('every switch is disabled while a save is in flight', () => {
	const client = loadClient();
	assert.equal(client.controlsDisabled(null), false);
	assert.equal(client.controlsDisabled(undefined), false);
	assert.equal(client.controlsDisabled('feedback'), true);
	assert.equal(client.controlsDisabled(''), true);
});
