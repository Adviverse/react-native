import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import core from '../dist/core.js';

const { buildAdHtml, parseMessage, loadsInWebView, createPacer, BASE_URL, SDK_URL } = core;
const app = { bundle: 'com.acme.app', platform: 'ios' };

test('html sets ADVIVERSE_APP + contextual consent and loads sdk/v1.js', () => {
  const h = buildAdHtml({ tag: 'tk_1', app, size: '320x50' });
  assert.match(h, /window\.ADVIVERSE_APP=\{"bundle":"com\.acme\.app","platform":"ios"\}/);
  assert.match(h, /ADVIVERSE_MIN_AC=0;window\.ADVIVERSE_MAX_AC=0;/);
  assert.ok(h.includes(JSON.stringify(SDK_URL)));
  assert.match(h, /width:320px;height:50px/);
  assert.ok(h.includes('"tag":"tk_1"'));
});

test('personalized lifts only the ceiling', () => {
  const h = buildAdHtml({ tag: 't', app, personalized: true });
  assert.match(h, /ADVIVERSE_MIN_AC=0;/);
  assert.doesNotMatch(h, /MAX_AC/);
});

test('values cannot break out of the script tag', () => {
  const h = buildAdHtml({ tag: '</script><script>alert(1)</script>', app });
  assert.equal(h.split('</script>').length - 1, 1, 'only the real closing tag');
});

test('bridge messages parse; junk and non-http opens are dropped', () => {
  assert.deepEqual(parseMessage('{"type":"filled","format":"banner","width":320,"height":50}'), { type: 'filled', format: 'banner', width: 320, height: 50 });
  assert.deepEqual(parseMessage('{"type":"no_fill"}'), { type: 'no_fill' });
  assert.deepEqual(parseMessage('{"type":"open","url":"https://serve.adviverse.com/click?rid=x"}'), { type: 'open', url: 'https://serve.adviverse.com/click?rid=x' });
  assert.equal(parseMessage('{"type":"open","url":"javascript:alert(1)"}'), undefined);
  assert.equal(parseMessage('not json'), undefined);
  assert.equal(parseMessage('{"type":"other"}'), undefined);
});

test('click interception: only the ad document and sub-frames load in the WebView', () => {
  assert.equal(loadsInWebView({ url: BASE_URL }), true);
  assert.equal(loadsInWebView({ url: 'about:blank' }), true);
  assert.equal(loadsInWebView({ url: 'https://cdn.example/creative.html', isTopFrame: false }), true);
  assert.equal(loadsInWebView({ url: 'https://serve.adviverse.com/click?rid=x' }), false);
  assert.equal(loadsInWebView({ url: 'https://brand.example/landing', isTopFrame: true }), false);
});

test('pacing: one per minIntervalSec, no-fills do not consume it', () => {
  const p = createPacer();
  assert.equal(p.allowed(60, 1000), true);
  p.mark(1000);
  assert.equal(p.allowed(60, 30000), false);
  assert.equal(p.allowed(60, 61000), true);
  assert.equal(p.allowed(0, 1001), true);
});

test('expo plugin adds SKAdNetworkItems (deduped) and the ATT string', () => {
  const { applyIosPlist } = createRequire(import.meta.url)('../app.plugin.js');
  const out = applyIosPlist({ SKAdNetworkItems: [{ SKAdNetworkIdentifier: 'abc.skadnetwork' }] },
    { skadnetworkIds: ['ABC.skadnetwork', 'def.skadnetwork'], userTrackingUsageDescription: 'Ads' });
  assert.deepEqual(out.SKAdNetworkItems, [{ SKAdNetworkIdentifier: 'abc.skadnetwork' }, { SKAdNetworkIdentifier: 'def.skadnetwork' }]);
  assert.equal(out.NSUserTrackingUsageDescription, 'Ads');
});

test('in-page bridge: reports fill + creative size, relays click-outs', async () => {
  const vm = await import('node:vm');
  const html = buildAdHtml({ tag: 'tk_1', app, size: '320x50' });
  const code = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
  const posted = [], listeners = {}, slot = { style: {} };
  let sdk, rendered;
  const win = {
    ReactNativeWebView: { postMessage: (s) => posted.push(JSON.parse(s)) },
    fetch: (u) => Promise.resolve(/\/ad\?/.test(u)
      ? { status: 200, clone: () => ({ json: () => Promise.resolve({ format: 'banner', creative: { width: 300, height: 250 } }) }) }
      : { status: 204 }),
    adviverse: { render: (el, o) => { rendered = [el, o]; } },
    MutationObserver: class { observe() {} },
    document: {
      readyState: 'complete', documentElement: {}, head: { appendChild: (s) => { sdk = s; } },
      createElement: () => ({}), getElementById: () => slot, querySelector: () => null,
      addEventListener: (t, f) => { listeners[t] = f; },
    },
  };
  win.window = win;
  vm.runInNewContext(code, win);
  assert.equal(win.ADVIVERSE_APP.bundle, 'com.acme.app');
  assert.equal(sdk.src, SDK_URL);
  sdk.onload();
  assert.deepEqual(JSON.parse(JSON.stringify(rendered[1])), { tag: 'tk_1', sizes: '320x50', app }); // vm realm
  await win.fetch('https://serve.adviverse.com/ad?tag=tk_1&client=app');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(posted.at(-1), { type: 'filled', format: 'banner', width: 300, height: 250 });
  assert.equal(slot.style.width, '300px');
  const w = win.open('https://serve.adviverse.com/click?rid=r1', '_blank');
  assert.ok(w, 'returns a window stub so the SDK never falls back to location.href');
  assert.deepEqual(posted.at(-1), { type: 'open', url: 'https://serve.adviverse.com/click?rid=r1' });
  let prevented = false;
  listeners.click({ target: { tagName: 'A', href: 'https://serve.adviverse.com/click?rid=r2' }, preventDefault: () => { prevented = true; } });
  assert.ok(prevented);
  assert.deepEqual(posted.at(-1), { type: 'open', url: 'https://serve.adviverse.com/click?rid=r2' });
});

test('optional peers are required directly inside try (else Metro makes them hard deps)', async () => {
  const { readFileSync } = await import('node:fs');
  const lines = readFileSync(new URL('../dist/host.js', import.meta.url), 'utf8').split('\n');
  const reqs = lines.flatMap((l, i) => (/require\(["']expo-/.test(l) ? [i] : []));
  assert.equal(reqs.length, 2);
  for (const i of reqs) assert.match(lines[i - 1], /try \{\s*$/, `line ${i + 1} is not directly in a try block`);
});
