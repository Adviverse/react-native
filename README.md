# @adviverse/react-native

Adviverse ads for React Native and Expo apps. Banners and interstitials render in a
`react-native-webview` running the Adviverse web SDK in **in-app mode**, so the engine
records them as **app inventory** (`client=app&bundle=<your bundle id>`), not website
traffic. Clicks open in the system browser; the WebView never navigates.

```bash
npx expo install @adviverse/react-native react-native-webview
# optional: bundle id + ATT
npx expo install expo-application expo-tracking-transparency
```

Create the placement under an **app property** (kind `mobile_app`, bundle id = your
app's bundle / package name). An app-mode request whose bundle doesn't match the
property's bundle id is refused (`X-Adviverse-NoFill: bundle_mismatch`).

## Banner

```tsx
import { AdView } from '@adviverse/react-native';

<AdView tag="tk_..." size="320x50" onEvent={(e) => console.log(e.type)} />
```

| Prop | Default | |
| --- | --- | --- |
| `tag` | required | Placement tag. |
| `size` | `"320x50"` | Requested slot size; the view then auto-sizes to the creative, and collapses to 0 height on no-fill. |
| `app` | expo-application `applicationId` + `Platform.OS` | `{bundle, platform}`. Bare RN without expo-application: pass `bundle` yourself (no bundle → the request is plain `client=web`). |
| `personalized` | `false` | `false` = contextual: no identifier is read or written. See consent. |
| `onEvent` | | `{type:'filled',format,width,height}` · `{type:'no_fill'}` · `{type:'open',url}` · `{type:'closed'}` |
| `style` | | Extra view style. |

## Interstitial

Mount the provider once, then call `showInterstitial` at a natural break:

```tsx
import { AdviverseProvider, showInterstitial } from '@adviverse/react-native';

export default function App() {
  return <AdviverseProvider><Root /></AdviverseProvider>;
}

const r = await showInterstitial('tk_...', { closeAfter: 5, minIntervalSec: 120 });
// 'no_fill' — no ad, paced, or no provider mounted
// 'closed'  — shown, then dismissed
// 'shown'   — shown, and the user tapped through to the browser
```

**Pacing.** `minIntervalSec` (default 60) is enforced in memory: a call within the
interval of the last *shown* interstitial resolves `'no_fill'` without a request (a
no-fill does not consume the interval). It resets on app restart. Don't interrupt
flows: show at level ends / after a completed action, not on launch or mid-task.
If you want "once every N actions", count them yourself and call on the Nth.

The close button appears after `closeAfter` seconds (default 5). Android back closes
once the button is shown.

## Consent

`personalized` defaults to `false`, which sets `ADVIVERSE_MIN_AC=0` + `ADVIVERSE_MAX_AC=0`
in the WebView: ads always load, contextually, with no cookie or id. Only pass `true`
when the user has allowed tracking:

```tsx
import { trackingAllowed } from '@adviverse/react-native';

const allowed = await trackingAllowed(); // iOS ATT via expo-tracking-transparency; false if not installed
<AdView tag="tk_..." personalized={allowed} />
```

- **iOS:** request ATT first (`requestTrackingPermissionsAsync` from expo-tracking-transparency); `trackingAllowed()` reads the current status.
- **Android:** `trackingAllowed()` does not see the Advertising-ID opt-out. Read it with your ad-id library and pass `personalized={allowed && !limitAdTracking}`.
- GDPR/CCPA: if your CMP says no personalization, pass `false`.

## Expo config plugin (iOS)

```json
{
  "expo": {
    "plugins": [
      ["@adviverse/react-native", {
        "skadnetworkIds": ["<adviverse-id>.skadnetwork"],
        "userTrackingUsageDescription": "Lets us show you more relevant ads."
      }]
    ]
  }
}
```

Adds `SKAdNetworkItems` (deduped) and `NSUserTrackingUsageDescription` to Info.plist.

## How it works

The WebView loads an HTML page (base URL `https://serve.adviverse.com/`) that sets
`window.ADVIVERSE_APP = {bundle, platform}` and loads `https://serve.adviverse.com/sdk/v1.js`.
The SDK then requests `/ad?...&client=app&bundle=...&platform=...` (no page URL or referrer)
and keeps its normal beacons and viewability. `window.open` and link clicks are relayed
to React Native and opened with `Linking.openURL`.

`expo-application` and `expo-tracking-transparency` are optional; each is `require`d
directly inside try/catch, which Metro treats as an optional dependency. Expo's Metro
config enables that by default. Bare React Native (plain Metro) does not: either install
both modules, or set `transformer: { allowOptionalDependencies: true }` in `metro.config.js`.
(0.1.0 required them through a helper, which Metro saw as hard dependencies: upgrade.)

## Develop

```bash
pnpm build   # tsc → dist
pnpm test    # node --test on the pure parts (HTML, bridge messages, click policy, pacing, plugin)
```
