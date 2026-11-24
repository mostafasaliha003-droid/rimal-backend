/*
 * When the welcome front opens: a signed-out visitor who launches the app onto Explore sees it,
 * every launch, until they sign in. "Explore first" quiets it for a week. Deep links (a checkout
 * return, a shared hotel) and visitors whose saved session is still being restored never see it.
 */
export const WELCOME_KEY = 'mkhadda.welcome.exploredAt.v1';
export const WELCOME_QUIET_MS = 7 * 24 * 60 * 60 * 1000;

export function shouldShowWelcome({ status, restorePending, pathname, exploredAt, now }: {
  status: 'loading' | 'signedIn' | 'signedOut'; restorePending?: boolean; pathname: string; exploredAt: unknown; now: number;
}) {
  if (status !== 'signedOut' || restorePending || pathname !== '/') return false;
  const at = typeof exploredAt === 'string' && /^\d{1,16}$/.test(exploredAt) ? Number(exploredAt) : NaN;
  return !(Number.isFinite(at) && now >= at && now - at < WELCOME_QUIET_MS);
}
