import React, { useCallback, useMemo, useState } from 'react';
import { Linking, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { BASE_URL, buildAdHtml, loadsInWebView, parseMessage, parseSize, type AdMessage, type AppInfo } from './core';
import { resolveApp } from './host';

export type AdViewProps = {
  /** Placement tag from the dashboard (an app property's placement). */
  tag: string;
  /** Slot size "WxH" (default "320x50"); the view then auto-sizes to the creative. */
  size?: string;
  style?: StyleProp<ViewStyle>;
  /** Defaults: bundle from expo-application, platform from Platform.OS. */
  app?: Partial<AppInfo>;
  /** Personalized ads (pass trackingAllowed()). Default false: contextual, no identifier. */
  personalized?: boolean;
  onEvent?: (e: AdMessage) => void;
  /** Override the SDK URL (staging). */
  sdkUrl?: string;
};

/** Opens a click-out in the system browser. */
export function openExternal(url: string) {
  Linking.openURL(url).catch(() => {});
}

/** Shared WebView wiring for banners and interstitials. */
export function AdWebView(props: AdViewProps & { onMessage: (m: AdMessage) => void }) {
  const { tag, size, personalized, sdkUrl, onMessage } = props;
  const app = resolveApp(props.app);
  const html = useMemo(
    () => buildAdHtml({ tag, size, personalized, sdkUrl, app }),
    [tag, size, personalized, sdkUrl, app.bundle, app.platform],
  );
  const handle = useCallback(
    (e: WebViewMessageEvent) => {
      const m = parseMessage(e.nativeEvent.data);
      if (!m) return;
      if (m.type === 'open') openExternal(m.url);
      onMessage(m);
    },
    [onMessage],
  );
  return (
    <WebView
      source={{ html, baseUrl: BASE_URL }}
      originWhitelist={['*']}
      style={[{ backgroundColor: 'transparent' }, props.style]}
      scrollEnabled={false}
      javaScriptEnabled
      allowsInlineMediaPlayback
      setSupportMultipleWindows={false}
      onMessage={handle}
      onShouldStartLoadWithRequest={(req) => {
        if (loadsInWebView(req)) return true;
        openExternal(req.url); // never navigate the ad WebView itself
        return false;
      }}
      onOpenWindow={(e) => openExternal(e.nativeEvent.targetUrl)}
    />
  );
}

/** A banner ad. Collapses to 0 height on no-fill. */
export function AdView(props: AdViewProps) {
  const initial = parseSize(props.size || '320x50') || { width: 320, height: 50 };
  const [box, setBox] = useState(initial);
  const { onEvent } = props;
  const onMessage = useCallback(
    (m: AdMessage) => {
      if (m.type === 'filled' && m.width > 0 && m.height > 0) setBox({ width: m.width, height: m.height });
      if (m.type === 'no_fill') setBox((b) => ({ ...b, height: 0 }));
      onEvent?.(m);
    },
    [onEvent],
  );
  return <AdWebView {...props} size={props.size || '320x50'} style={[box, props.style]} onMessage={onMessage} />;
}
