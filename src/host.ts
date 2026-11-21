import { Platform } from 'react-native';
import type { AppInfo } from './core';

// Optional peers, resolved at runtime. Metro treats a require inside try/catch as
// an optional dependency (allowOptionalDependencies, on by default), so apps
// without these modules still bundle.
function optional<T>(load: () => T): T | undefined {
  try {
    return load();
  } catch {
    return undefined;
  }
}

/** App identity for ad requests: explicit props win, else expo-application + Platform. */
export function resolveApp(app?: Partial<AppInfo>): AppInfo {
  const expoApp = app?.bundle
    ? undefined
    : optional(() => require('expo-application') as { applicationId?: string | null });
  return {
    bundle: app?.bundle || expoApp?.applicationId || '',
    platform: app?.platform || Platform.OS,
  };
}

/**
 * Whether the host may request personalized ads. iOS: App Tracking Transparency
 * via expo-tracking-transparency when installed. Without it: false (contextual).
 * Android: also check the user's ad-ID opt-out yourself and pass
 * `personalized={allowed && !limitAdTracking}`.
 */
export async function trackingAllowed(): Promise<boolean> {
  const att = optional(
    () => require('expo-tracking-transparency') as { getTrackingPermissionsAsync: () => Promise<{ granted: boolean }> },
  );
  if (!att) return false;
  try {
    return (await att.getTrackingPermissionsAsync()).granted === true;
  } catch {
    return false;
  }
}
