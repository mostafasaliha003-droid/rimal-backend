import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { APP_ENV, endpoints } from '../api/config';
import { createCrashReporter } from './crashReportModel';

let currentRoute = '';
/** The root layout keeps this up to date so a report says which screen failed. */
export const setCrashRoute = (pathname: string) => { currentRoute = pathname; };

export const reportCrash = createCrashReporter({
  context: () => ({ version: Constants.expoConfig?.version ?? '', platform: Platform.OS, route: currentRoute }),
  send: async report => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      await fetch(endpoints(APP_ENV).api + '/app/errors', { method: 'POST', signal: controller.signal, credentials: 'omit', redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
    } finally { clearTimeout(timer); }
  }
});

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsShape { getGlobalHandler(): GlobalHandler; setGlobalHandler(handler: GlobalHandler): void }

let installed = false;
/** Reports uncaught JavaScript errors, then hands them to the platform's own handler unchanged. */
export function installCrashReporter() {
  if (installed) return;
  installed = true;
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
  if (errorUtils?.getGlobalHandler && errorUtils.setGlobalHandler) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => { reportCrash(error, Boolean(isFatal)); previous?.(error, isFatal); });
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.addEventListener('error', event => { reportCrash(event.error ?? event.message, false); });
    window.addEventListener('unhandledrejection', event => { reportCrash(event.reason, false); });
  }
}
