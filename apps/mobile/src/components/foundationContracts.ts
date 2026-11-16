import type { Language, SearchCriteria } from '../types';

export function hotelSearchPlan(criteria: SearchCriteria | null, language: Language, savedIds: number[] | null) {
  if (!criteria || savedIds !== null && savedIds.length === 0) return null;
  const payload: SearchCriteria = savedIds === null ? { ...criteria, language } : { ...criteria, language, regionId: undefined, hids: savedIds };
  return { criteria: payload, key: JSON.stringify(payload) };
}
export function membershipPresentation(status: number | undefined, signedIn: boolean): 'approval' | 'signin' {
  return status === 403 && signedIn ? 'approval' : 'signin';
}
export const REGISTRATION_MIN_PASSWORD_LENGTH = 10;
export function registrationFormReady(name: string, email: string, password: string): boolean {
  return Boolean(name.trim() && /^\S+@\S+\.\S+$/.test(email.trim()) && password.length >= REGISTRATION_MIN_PASSWORD_LENGTH);
}
