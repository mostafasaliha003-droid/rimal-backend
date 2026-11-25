/*
 * Who may see what. Mkhadda is members-only: hotels, prices and saved stays open only to a
 * signed-in member whose membership is approved. A visitor sees the welcome front and the
 * sign-in / sign-up form; a signed-in applicant sees their membership application, account,
 * notifications, support and any trip they already have.
 */
export type Access = 'checking' | 'guest' | 'applicant' | 'member' | 'offline';

export function accessFor({ authStatus, restorePending, membership }: {
  authStatus: 'loading' | 'signedIn' | 'signedOut';
  restorePending?: boolean;
  /** The membership answer for the signed-in account: true/false, 'error' when it could not be read, null while loading. */
  membership: boolean | 'error' | null;
}): Access {
  if (authStatus === 'loading') return 'checking';
  // A saved session that could not be checked (no connection) is not a visitor.
  if (authStatus === 'signedOut') return restorePending ? 'offline' : 'guest';
  if (membership === null) return 'checking';
  if (membership === 'error') return 'offline';
  return membership ? 'member' : 'applicant';
}

const GUEST_ROUTES = new Set(['/welcome', '/account', '/support']);
const APPLICANT_ROUTES = new Set(['/account', '/membership', '/notifications', '/support', '/account-deletion', '/bookings', '/checkout']);

function clean(pathname: string) {
  const path = (pathname || '/').split(/[?#]/)[0].replace(/\/+$/, '');
  return path || '/';
}

/** True when the route shows hotels, prices or saved stays: members only. */
export function memberOnly(pathname: string) {
  const path = clean(pathname);
  return !GUEST_ROUTES.has(path) && !APPLICANT_ROUTES.has(path) && !path.startsWith('/cancel/');
}

/**
 * Where to send someone who opened a route they may not see, or null to stay. Guests go to the
 * welcome front, applicants to their membership page, members leave the welcome front.
 * 'checking' and 'offline' never redirect: the screen is covered until the answer is known.
 */
export function accessRedirect(access: Access, pathname: string): '/welcome' | '/membership' | '/' | null {
  const path = clean(pathname);
  if (access === 'guest') return GUEST_ROUTES.has(path) ? null : '/welcome';
  if (access === 'applicant') return memberOnly(path) || path === '/welcome' ? '/membership' : null;
  if (access === 'member') return path === '/welcome' ? '/' : null;
  return null;
}

/** A deep link a guest opened, kept so sign-in can return to it. Only member routes worth returning to. */
export function returnPath(pathname: string): string | undefined {
  const path = clean(pathname);
  if (path === '/' || !memberOnly(path)) return undefined;
  return /^\/(results|saved|saved-offers|saved-dates|compare|review|hotel\/[1-9]\d{0,9})$/.test(path) ? path : undefined;
}
