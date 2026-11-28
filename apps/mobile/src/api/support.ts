import type { createTransport } from './transport';
import { ApiError, invalidResponse } from './errors';

/*
 * Pillow Stays care: one private conversation per booking with the support team, inside the app.
 * It is the same conversation the team answers from its dashboard (and the website shows),
 * so nothing has to be repeated and no second sign-in is needed.
 */
type Request = ReturnType<typeof createTransport>;

export type SupportTopic = 'booking' | 'payment' | 'voucher' | 'cancellation' | 'refund' | 'other';
export type SupportStatus = 'open' | 'waiting' | 'resolved';
export interface SupportConversation {
  id: string; reference: string; hotelName: string; topic: SupportTopic; status: SupportStatus;
  lastMessage: string; updatedAt: string; unread: boolean;
}
export interface SupportMessage { id: string; body: string; mine: boolean; createdAt: string }
export interface SupportThread { conversation: SupportConversation; messages: SupportMessage[] }

const TOPICS: readonly SupportTopic[] = ['booking', 'payment', 'voucher', 'cancellation', 'refund', 'other'];
const STATUSES: readonly SupportStatus[] = ['open', 'waiting', 'resolved'];
export const MESSAGE_LIMIT = 2000;
const CONVERSATION_ID = /^[a-f\d]{64}$/;

/** The support routes answer without the success envelope; the transport accepts exactly these. */
export const supportRoute = (path: string) => path === '/support/conversations'
  || /^\/support\/conversations\/[a-f\d]{64}(?:\/messages)?$/.test(path);

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.slice(0, limit) : '';
const time = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : '';
export const validSupportReference = (value: string) => /^[A-Za-z0-9_-]{1,120}$/.test(value);

export function normalizeConversation(value: unknown): SupportConversation {
  const row = object(value);
  if (typeof row.id !== 'string' || !CONVERSATION_ID.test(row.id) || typeof row.reference !== 'string' || !validSupportReference(row.reference)) throw invalidResponse();
  return { id: row.id, reference: row.reference, hotelName: text(row.hotelName, 200),
    topic: TOPICS.find(item => item === row.topic) ?? 'booking', status: STATUSES.find(item => item === row.status) ?? 'open',
    lastMessage: text(row.lastMessage, 160), updatedAt: time(row.updatedAt), unread: row.unread === true };
}

export function normalizeMessages(value: unknown): SupportMessage[] {
  if (!Array.isArray(value)) throw invalidResponse();
  return value.flatMap(item => {
    const row = object(item);
    if (typeof row.id !== 'string' || typeof row.body !== 'string' || !row.body.trim()) return [];
    if (row.role !== 'user' && row.role !== 'admin') return [];
    return [{ id: row.id, body: row.body.slice(0, MESSAGE_LIMIT), mine: row.role === 'user', createdAt: time(row.createdAt) }];
  });
}

/** A message the server will accept: trimmed, not empty, within the limit, no control characters. */
export function cleanMessage(value: string) {
  const body = value.replace(/\r\n?/g, '\n').trim();
  return body && body.length <= MESSAGE_LIMIT && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body) ? body : '';
}

export function createSupportApi(request: Request) {
  const thread = (id: string) => {
    if (!CONVERSATION_ID.test(id)) throw new ApiError('validation', 'support_not_found');
    return '/support/conversations/' + id;
  };
  return {
    async conversations(signal?: AbortSignal): Promise<SupportConversation[]> {
      const rows = object(await request('GET', '/support/conversations', { signal, timeoutMs: 20000 })).conversations;
      if (!Array.isArray(rows)) throw invalidResponse();
      return rows.flatMap(row => { try { return [normalizeConversation(row)]; } catch { return []; } });
    },
    /** Opens (or reopens) the one conversation for this booking. */
    async open(reference: string, topic: SupportTopic = 'booking', signal?: AbortSignal): Promise<SupportConversation> {
      if (!validSupportReference(reference)) throw new ApiError('validation', 'support_reference_not_found');
      return normalizeConversation(object(await request('POST', '/support/conversations', { signal, timeoutMs: 20000, body: { reference, topic } })).conversation);
    },
    async read(id: string, signal?: AbortSignal): Promise<SupportThread> {
      const row = object(await request('GET', thread(id), { signal, timeoutMs: 20000 }));
      return { conversation: normalizeConversation(row.conversation), messages: normalizeMessages(row.messages) };
    },
    /** clientId makes a retried send land once. */
    async send(id: string, body: string, clientId: string, signal?: AbortSignal): Promise<SupportMessage> {
      const clean = cleanMessage(body);
      if (!clean || !/^[a-f\d-]{36}$/i.test(clientId)) throw new ApiError('validation', 'support_invalid_message');
      const [message] = normalizeMessages([object(await request('POST', thread(id) + '/messages', { signal, timeoutMs: 20000, body: { body: clean, clientId } })).message]);
      if (!message) throw invalidResponse();
      return message;
    },
  };
}
