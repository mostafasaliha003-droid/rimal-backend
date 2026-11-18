import { ApiError, invalidResponse } from './errors';
import { membershipStatus, type MemberState } from './membership';
import type { createTransport } from './transport';

type MemberEvent = Exclude<MemberState, 'draft'>;
export interface OwnedNotice { id: string; kind: 'booking' | 'membership'; event: MemberEvent | 'confirmed' | 'refunded'; at: string | null }
const memberEvents = ['submitted', 'under_review', 'needs_information', 'approved', 'rejected', 'suspended'];
export async function ownedNotices(request: ReturnType<typeof createTransport>, signal?: AbortSignal): Promise<OwnedNotice[]> {
  const token = await request.captureSessionToken(signal);
  let response: unknown;
  try { response = await request('GET', '/owned/notifications', { token, signal, timeoutMs: 20000 }); }
  catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    const status = await membershipStatus(request, signal, token);
    return status.authenticated && status.notice && status.notice !== 'draft' ?
      [{ id: 'membership-latest', kind: 'membership', event: status.notice, at: null }] : [];
  }
  const list = (response as { notifications?: unknown })?.notifications;
  if (!Array.isArray(list)) throw invalidResponse();
  return list.slice(0, 100).flatMap(row => {
    if (!row || typeof row.id !== 'string' || !row.id || row.id.length > 256 ||
      typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at))) return [];
    if (!(row.kind === 'booking' && ['confirmed','refunded'].includes(row.event) ||
      row.kind === 'membership' && memberEvents.includes(row.event))) return [];
    return [{ id: row.id, kind: row.kind, event: row.event, at: row.at }];
  });
}
