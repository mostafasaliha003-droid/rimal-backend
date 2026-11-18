import type { createTransport, RequestOptions } from './transport';
import { ApiError, invalidResponse } from './errors';

const states = ['draft', 'submitted', 'under_review', 'needs_information', 'approved', 'rejected', 'suspended'] as const;
export type MemberState = typeof states[number];
export type MemberCategory = 'gcc_citizen' | 'uae_professional';
export const documentKinds = ['passport', 'eid_front', 'eid_back'] as const;
export type DocumentKind = typeof documentKinds[number];
export interface MemberDetails { category: MemberCategory; nationality: string; profession: string; professionTitle: string }
export interface MemberStatus {
  details: MemberDetails | null;
  documents: DocumentKind[];
  enabled: boolean;
  authenticated: boolean;
  canAccess: boolean;
  status: MemberState | null;
  note: string;
  notice: MemberState | null;
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function state(value: unknown): MemberState | null {
  return states.find(item => item === value) || null;
}
export async function membershipStatus(request: ReturnType<typeof createTransport>, signal?: AbortSignal, token?: string): Promise<MemberStatus> {
  const row = object(await request('GET', '/membership/status', { signal, token, timeoutMs: 15000 }));
  if (typeof row.enabled !== 'boolean' || row.enabled && typeof row.authenticated !== 'boolean') throw invalidResponse();
  const authenticated = row.enabled && row.authenticated === true;
  const application = object(row.application);
  const status = authenticated ? state(application.status) : null;
  if (authenticated && row.application != null && !status) throw invalidResponse();
  const category = application.category;
  const details: MemberDetails | null = authenticated && (category === 'gcc_citizen' || category === 'uae_professional') ? {
    category, nationality: typeof application.nationality === 'string' ? application.nationality : '',
    profession: typeof application.profession === 'string' ? application.profession : '',
    professionTitle: typeof application.professionTitle === 'string' ? application.professionTitle.slice(0, 160) : '',
  } : null;
  const documents = authenticated && Array.isArray(application.documents) ? documentKinds.filter(kind =>
    (application.documents as unknown[]).some(item => object(item).kind === kind)) : [];
  return { details, documents, enabled: row.enabled, authenticated, canAccess: authenticated && status === 'approved' && row.canAccess === true,
    status, note: authenticated && typeof application.publicNote === 'string' ? application.publicNote.slice(0, 1200) : '',
    notice: authenticated ? state(object(row.notification).event) : null };
}

const protectedRatePaths = new Set(['/search/rates', '/search/rates/region', '/search/hotelpage',
  '/booking/prebook', '/payment/quote', '/payment/ziina/intent']);

// A status change must be reflected before exposing another set of private rates.
// Recovering an existing attempt remains possible while membership is under review.
export async function requireMemberRateAccess(request: ReturnType<typeof createTransport>, options: RequestOptions = {}) {
    let token: string;
    try { token = options.token || await request.captureSessionToken(options.signal); }
    catch (error) {
      if (error instanceof ApiError && error.kind === 'auth') throw new ApiError('membership', 'membership_authentication_required', 401);
      throw error;
    }
    let membership: MemberStatus;
    try { membership = await membershipStatus(request, options.signal, token); }
    catch (error) {
      if (options.signal?.aborted || error instanceof ApiError && error.kind === 'aborted') throw error;
      if (error instanceof ApiError && error.status === 401) throw new ApiError('membership', 'membership_authentication_required', 401);
      if (error instanceof ApiError && error.status === 403) throw new ApiError('membership', 'membership_approval_required', 403);
      throw new ApiError('membership', 'membership_status_unavailable', 503);
    }
    if (membership.enabled && !membership.authenticated) throw new ApiError('membership', 'membership_authentication_required', 401);
    if (!membership.canAccess) throw new ApiError('membership', 'membership_approval_required', 403);
    return token;
}

export function memberRateAccessDenied(error: unknown) {
  return error instanceof ApiError && (error.kind === 'auth' || error.kind === 'membership') && (error.status === 401 || error.status === 403);
}

export function withMemberRates(request: ReturnType<typeof createTransport>) {
  const guarded = async (method: 'GET' | 'POST' | 'PUT', path: string, options: RequestOptions = {}) => {
    if (method !== 'POST' || !protectedRatePaths.has(path)) return request(method, path, options);
    const token = await requireMemberRateAccess(request, options);
    return request(method, path, { ...options, token });
  };
  return Object.assign(guarded, { captureSessionToken: request.captureSessionToken });
}
