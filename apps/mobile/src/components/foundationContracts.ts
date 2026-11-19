import type { Language, SearchCriteria } from '../types';

export function hotelSearchPlan(criteria: SearchCriteria | null, language: Language, savedIds: number[] | null) {
  if (!criteria || savedIds !== null && savedIds.length === 0) return null;
  const payload: SearchCriteria = savedIds === null ? { ...criteria, language } : { ...criteria, language, regionId: undefined, hids: savedIds };
  return { criteria: payload, key: JSON.stringify(payload) };
}
export function membershipPresentation(status: number | undefined, signedIn: boolean): 'approval' | 'signin' | 'verify' {
  if (!signedIn) return 'signin';
  return status === 403 ? 'approval' : 'verify';
}

export function afterSignInRoute(requested: unknown) {
  switch (requested) {
    case '/results': case '/saved': case '/saved-offers': case '/saved-dates': case '/bookings':
    case '/membership': case '/notifications': case '/account-deletion': case '/compare':
    case '/checkout': case '/review': case '/support':
      return requested;
    default: {
      const hotel = typeof requested === 'string' && /^\/hotel\/([1-9]\d{0,9})$/.exec(requested);
      return hotel ? { pathname: '/hotel/[hid]' as const, params: { hid: hotel[1] } } : '/' as const;
    }
  }
}
export const REGISTRATION_MIN_PASSWORD_LENGTH = 10;
export function registrationFormReady(name: string, email: string, password: string): boolean {
  return Boolean(name.trim() && /^\S+@\S+\.\S+$/.test(email.trim()) && password.length >= REGISTRATION_MIN_PASSWORD_LENGTH);
}
export function normalizeVerificationCode(text: string): string {
  return text.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, digit => {
    const value = digit.charCodeAt(0);
    return String(value - (value >= 0x06f0 ? 0x06f0 : 0x0660));
  }).replace(/[^0-9]/g, '').slice(0, 6);
}
