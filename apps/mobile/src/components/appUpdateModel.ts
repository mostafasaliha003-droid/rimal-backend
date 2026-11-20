// In-app update prompt for builds installed outside an app store.
// The server reports the newest Android build; this decides what the guest sees.

export interface AndroidRelease {
  latestVersionCode: number; latestVersion: string; minimumVersionCode: number; downloadUrl: string;
}
export type UpdateDecision = 'none' | 'optional' | 'required';

// Must match services/appVersion.js on the server: only these hosts may serve the APK.
const DOWNLOAD_HOSTS = new Set(['github.com', 'play.google.com']);
const positive = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** A validated release from the server's /app/version answer, or null. */
export function normalizeRelease(value: unknown): AndroidRelease | null {
  const android = value && typeof value === 'object' ? (value as { android?: unknown }).android : null;
  if (!android || typeof android !== 'object') return null;
  const release = android as Record<string, unknown>;
  if (!positive(release.latestVersionCode) || typeof release.latestVersion !== 'string'
    || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(release.latestVersion)) return null;
  const minimum = release.minimumVersionCode === 0 || positive(release.minimumVersionCode) ? release.minimumVersionCode as number : 0;
  let url: URL;
  try { url = new URL(String(release.downloadUrl)); } catch { return null; }
  if (url.protocol !== 'https:' || !DOWNLOAD_HOSTS.has(url.hostname) || url.username || url.password) return null;
  return { latestVersionCode: release.latestVersionCode as number, latestVersion: release.latestVersion,
    minimumVersionCode: Math.min(minimum, release.latestVersionCode as number), downloadUrl: url.href };
}

/**
 * required: this build is below the minimum and must update before use.
 * optional: a newer build exists and the guest has not set this version aside.
 */
export function updateDecision(currentVersionCode: number | null | undefined, release: AndroidRelease | null,
  dismissedVersionCode: number | null = null): UpdateDecision {
  if (!release || !positive(currentVersionCode)) return 'none';
  const current = currentVersionCode as number;
  if (current < release.minimumVersionCode) return 'required';
  if (release.latestVersionCode > current && dismissedVersionCode !== release.latestVersionCode) return 'optional';
  return 'none';
}
