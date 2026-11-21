import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { createPacer, type AdMessage, type AppInfo } from './core';
import { AdWebView } from './AdView';

export type InterstitialResult = 'shown' | 'no_fill' | 'closed';

export type InterstitialOptions = {
  /** Seconds before the close button appears (default 5). */
  closeAfter?: number;
  app?: Partial<AppInfo>;
  /** Personalized ads (pass trackingAllowed()). Default false. */
  personalized?: boolean;
  /** Pacing: at most one interstitial per this many seconds (default 60, in-memory). */
  minIntervalSec?: number;
};

type Request = { tag: string; opts: InterstitialOptions; resolve: (r: InterstitialResult) => void };

const pacer = createPacer();
let present: ((r: Request) => void) | null = null;

/**
 * Shows a full-screen interstitial. Resolves "no_fill" (no ad, paced, or no
 * <AdviverseProvider> mounted), "closed" (shown, then dismissed) or "shown"
 * (shown, and the user tapped through to the browser).
 */
export function showInterstitial(tag: string, opts: InterstitialOptions = {}): Promise<InterstitialResult> {
  if (!present || !pacer.allowed(opts.minIntervalSec ?? 60)) return Promise.resolve('no_fill');
  const show = present;
  return new Promise((resolve) => show({ tag, opts, resolve }));
}

/** Mount once near the app root; hosts the interstitial modal. */
export function AdviverseProvider({ children }: { children?: React.ReactNode }) {
  const [req, setReq] = useState<Request | null>(null);
  const [filled, setFilled] = useState(false);
  const [canClose, setCanClose] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const current = useRef<Request | null>(null);

  const finish = (result: InterstitialResult) => {
    const r = current.current;
    if (!r) return;
    current.current = null;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    r.resolve(result);
    setReq(null);
  };

  useEffect(() => {
    present = (r) => {
      if (current.current) return r.resolve('no_fill'); // one at a time
      current.current = r;
      setFilled(false);
      setCanClose(false);
      setReq(r);
      timers.current.push(setTimeout(() => finish('no_fill'), 10000)); // SDK never answered
    };
    return () => {
      present = null;
      finish('no_fill');
    };
  }, []);

  const onMessage = (m: AdMessage) => {
    if (m.type === 'filled') {
      pacer.mark();
      timers.current.forEach(clearTimeout);
      timers.current = [setTimeout(() => setCanClose(true), (current.current?.opts.closeAfter ?? 5) * 1000)];
      setFilled(true);
    } else if (m.type === 'no_fill') finish('no_fill');
    else if (m.type === 'open') finish('shown');
    else if (m.type === 'closed') finish('closed');
  };

  return (
    <>
      {children}
      {req ? (
        // Visible but transparent while the request runs (a Modal that is not
        // visible never mounts its WebView); the ad appears on "filled".
        <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => canClose && finish('closed')}>
          <View style={[styles.fill, filled ? styles.backdrop : styles.pending]}>
            <AdWebView tag={req.tag} app={req.opts.app} personalized={req.opts.personalized} style={styles.fill} onMessage={onMessage} />
            {filled && canClose ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Close ad" onPress={() => finish('closed')} style={styles.close} hitSlop={12}>
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            ) : null}
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#000' },
  pending: { opacity: 0 },
  fill: { flex: 1 },
  close: {
    position: 'absolute', top: 48, right: 16, width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  closeText: { color: '#fff', fontSize: 22, lineHeight: 24 },
});
