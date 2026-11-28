/**
 * App crash reports, kept on Pillow Stays' own server (POST /api/app/errors): no third-party tracker,
 * no account, no token. The report carries the error text, the first stack lines, the app version,
 * the platform and the screen route. The server scrubs e-mails, numbers and ids again before storing.
 */
export interface CrashReport { message: string; stack: string; fatal: boolean; version: string; platform: string; route: string }

const MAX_PER_SESSION = 8;

/** Removes anything that could identify a guest before the report leaves the phone. */
export function scrubReportText(value: string) {
  return value
    .replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b[a-f\d]{24,}\b/gi, '[token]')
    .replace(/\+?\d[\d\s-]{6,}\d/g, '[number]');
}

/** Screen routes only: dynamic segments longer than 11 characters (references, ids) become [id]. */
export function reportRoute(pathname: unknown) {
  if (typeof pathname !== 'string' || !/^\/[A-Za-z0-9/_\-[\]]{0,120}$/.test(pathname)) return '';
  return pathname.replace(/\/[A-Za-z0-9_-]{12,}/g, '/[id]');
}

export function buildCrashReport(error: unknown, context: { fatal: boolean; version: string; platform: string; route: string }): CrashReport | null {
  const name = error instanceof Error ? error.name : 'Error';
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = scrubReportText(`${name}: ${raw || 'unknown error'}`).slice(0, 500);
  const stack = error instanceof Error && typeof error.stack === 'string' ? scrubReportText(error.stack.split('\n').slice(0, 12).join('\n')).slice(0, 4000) : '';
  return { message, stack, fatal: context.fatal, version: /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(context.version) ? context.version : 'unknown',
    platform: ['android', 'ios', 'web'].includes(context.platform) ? context.platform : 'unknown', route: reportRoute(context.route) };
}

/**
 * One report per distinct error per app session, at most eight in all, so a render loop cannot
 * flood the server or the phone's data. Sending never throws.
 */
export function createCrashReporter({ send, context }: {
  send: (report: CrashReport) => Promise<unknown>;
  context: () => { version: string; platform: string; route: string };
}) {
  const seen = new Set<string>();
  return function report(error: unknown, fatal = false) {
    const built = buildCrashReport(error, { ...context(), fatal });
    if (!built) return false;
    const key = `${built.message}|${built.stack.split('\n').slice(0, 2).join('|')}`;
    if (seen.has(key) || seen.size >= MAX_PER_SESSION) return false;
    seen.add(key);
    try { void Promise.resolve(send(built)).catch(() => undefined); } catch { /* reporting must never crash the app */ }
    return true;
  };
}
