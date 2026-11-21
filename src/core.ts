// Pure, device-free parts of @adviverse/react-native: the WebView HTML, the
// in-page bridge, message parsing, click interception and interstitial pacing.
// Nothing here imports react-native, so it is unit-tested under plain node.

export const SERVE_ORIGIN = 'https://serve.adviverse.com';
/** The WebView document's base URL. Same origin as the engine, which /ad allows. */
export const BASE_URL = SERVE_ORIGIN + '/';
export const SDK_URL = SERVE_ORIGIN + '/sdk/v1.js';

export type AppInfo = { bundle: string; platform: string };

export type AdHtmlOptions = {
  tag: string;
  app: AppInfo;
  /** true only when the host has tracking consent (see trackingAllowed). */
  personalized?: boolean;
  /** "WxH" slot size, e.g. "320x50". */
  size?: string;
  /** Override the SDK URL (staging / tests). */
  sdkUrl?: string;
};

/** Messages the in-page bridge posts back to React Native. */
export type AdMessage =
  | { type: 'filled'; format: string; width: number; height: number }
  | { type: 'no_fill' }
  | { type: 'open'; url: string }
  | { type: 'closed' };

/** Parses "320x50" → {width, height}; undefined when not a fixed size. */
export function parseSize(size?: string): { width: number; height: number } | undefined {
  const m = /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(size || '');
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

// JSON for a <script> body: "<" escaped so a value can never close the tag.
const js = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/**
 * Runs in the WebView before the SDK. It reports fill / no-fill (and the
 * creative size, for auto-sizing) by watching the SDK's /ad fetch, turns every
 * click-out (window.open, target=_blank links) into an "open" message so the
 * WebView itself never navigates, and reports the SDK interstitial closing.
 */
const bridge = (sdkUrl: string, renderOpts: unknown) => `(function(){
var RN=window.ReactNativeWebView;
function post(m){try{RN&&RN.postMessage(JSON.stringify(m));}catch(e){}}
var of=window.fetch;
window.fetch=function(u){var p=of.apply(this,arguments);
if(String(u).indexOf('/ad?')>=0){p.then(function(r){
if(r.status!==200){post({type:'no_fill'});return;}
r.clone().json().then(function(ad){var c=(ad&&ad.creative)||{};
var s=document.getElementById('adv-slot');if(s&&c.width&&c.height){s.style.width=c.width+'px';s.style.height=c.height+'px';}
post({type:'filled',format:String((ad&&ad.format)||''),width:c.width||0,height:c.height||0});
},function(){post({type:'no_fill'});});
},function(){post({type:'no_fill'});});}
return p;};
window.open=function(u){if(u)post({type:'open',url:String(u)});return{blur:function(){},focus:function(){},close:function(){},closed:false};};
document.addEventListener('click',function(e){var n=e.target;
while(n&&n.tagName!=='A')n=n.parentNode;
if(n&&n.href&&n.href.indexOf('javascript:')!==0){e.preventDefault();post({type:'open',url:n.href});}
},true);
var seen=false;new MutationObserver(function(){var o=document.querySelector('.adnet-interstitial');
if(o)seen=true;else if(seen){seen=false;post({type:'closed'});}
}).observe(document.documentElement,{childList:true,subtree:true});
var sdk=document.createElement('script');sdk.src=${js(sdkUrl)};
function go(){window.adviverse.render(document.getElementById('adv-slot'),${js(renderOpts)});}
sdk.onload=function(){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();};
sdk.onerror=function(){post({type:'no_fill'});};
document.head.appendChild(sdk);
})();`;

/** Builds the WebView document for one ad slot. */
export function buildAdHtml(o: AdHtmlOptions): string {
  const sz = parseSize(o.size);
  const slotStyle = sz ? `width:${sz.width}px;height:${sz.height}px` : 'width:100%;height:100%';
  // Contextual by default: MIN_AC=0 always serves, MAX_AC=0 never personalizes
  // (no identifier read or written). Personalized lifts only the ceiling.
  const consent = o.personalized ? 'window.ADVIVERSE_MIN_AC=0;' : 'window.ADVIVERSE_MIN_AC=0;window.ADVIVERSE_MAX_AC=0;';
  const renderOpts = { tag: o.tag, sizes: o.size || '', app: o.app };
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;height:100%}#adv-slot{margin:0 auto}</style>
<script>window.ADVIVERSE_APP=${js(o.app)};${consent}${bridge(o.sdkUrl || SDK_URL, renderOpts)}</script>
</head><body><div id="adv-slot" style="${slotStyle}"></div></body></html>`;
}

/** Parses a bridge message; undefined for anything malformed or unknown. */
export function parseMessage(data: string): AdMessage | undefined {
  let m: unknown;
  try {
    m = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (!m || typeof m !== 'object') return undefined;
  const r = m as Record<string, unknown>;
  switch (r.type) {
    case 'filled':
      return { type: 'filled', format: String(r.format || ''), width: Number(r.width) || 0, height: Number(r.height) || 0 };
    case 'no_fill':
    case 'closed':
      return { type: r.type };
    case 'open':
      return typeof r.url === 'string' && /^https?:\/\//i.test(r.url) ? { type: 'open', url: r.url } : undefined;
    default:
      return undefined;
  }
}

/**
 * onShouldStartLoadWithRequest policy: only the ad document itself and creative
 * sub-frames load in the WebView; any other top-frame navigation is a click-out
 * that must go to the system browser instead.
 */
export function loadsInWebView(req: { url: string; isTopFrame?: boolean }): boolean {
  if (req.isTopFrame === false) return true; // sandboxed creative iframes (html5 / playable)
  const u = req.url || '';
  return u === BASE_URL || u === SERVE_ORIGIN || u === 'about:blank' || u.startsWith('about:srcdoc') || u.startsWith('data:');
}

/** In-memory interstitial pacing: at most one shown per minIntervalSec. */
export function createPacer() {
  let last = -Infinity;
  return {
    /** May an interstitial be shown now? */
    allowed(minIntervalSec: number, now = Date.now()): boolean {
      return now - last >= minIntervalSec * 1000;
    },
    /** Record that one was actually shown (no-fills don't consume the interval). */
    mark(now = Date.now()) {
      last = now;
    },
  };
}
