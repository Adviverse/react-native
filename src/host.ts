import { Platform } from 'react-native';
import type { AppInfo } from './core';

// Optional peers. Metro only marks a require optional (allowOptionalDependencies)
// when the require statement sits DIRECTLY in a try block — not inside a helper's
// callback — so each require keeps its own try/catch.
function loadExpoApplication(): { applicationId?: string | null } | undefined {
  try {
    return require('expo-application');
  } catch {
    return undefined;
  }
}

function loadTrackingTransparency(): { getTrackingPermissionsAsync: () => Promise<{ granted: boolean }> } | undefined {
  try {
    return require('expo-tracking-transparency');
  } catch {
    return undefined;
  }
}

/** App identity for ad requests: explicit props win, else expo-application + Platform. */
export function resolveApp(app?: Partial<AppInfo>): AppInfo {
  const expoApp = app?.bundle
    ? undefined
    : loadExpoApplication();
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
  const att = loadTrackingTransparency();
  if (!att) return false;
  try {
    return (await att.getTrackingPermissionsAsync()).granted === true;
  } catch {
    return false;
  }
}
