import type { Language, PrebookResult, RegistrationInput, RoomOffer, SearchCriteria } from '../types';
import { ApiError, invalidResponse } from './errors';
import { normalizeDetails, normalizeHotel, normalizeOffers, normalizeSuggestions, normalizeUser, object } from './adapters';
import { assertCriteria, hotelId, searchBody } from './validation';
import { createTransport, validToken } from './transport';
import { getOwnedBookings } from './bookings';
import { getAccountDeletionRequest, requestAccountDeletion } from './accountDeletion';
import { ownedNotices } from './notifications';
import { membershipStatus, requireMemberRateAccess, type DocumentKind, type MemberDetails } from './membership';
import type { DocumentUpload } from './transport';
import { createCheckoutApi } from './checkout';

const sameAmount = (left: string, right: string) => {
  const normalize = (value: string) => { const [whole, fraction = ''] = value.split('.'); const tail = fraction.replace(/0+$/, '');
    return `${whole.replace(/^0+(?=\d)/, '')}${tail ? `.${tail}` : ''}`; };
  return normalize(left) === normalize(right);
};

type Request = ReturnType<typeof createTransport>;
export function createApiClient(request: Request) {
  function credentials(value: unknown) {
    const row = object(value);
    if (!validToken(row.access_token)) throw invalidResponse();
    return { user: normalizeUser(row.user), token: row.access_token };
  }
  const auth = {
    async login(email: string, password: string, signal?: AbortSignal) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254 || !password || password.length > 256)
        throw new ApiError('validation', 'invalid_credentials');
      return credentials(await request('POST', '/auth/login', { anonymous: true, signal, timeoutMs: 20000,
        body: { email: email.trim().toLowerCase(), password } }));
    },
    async requestRegistration(input: RegistrationInput, signal?: AbortSignal) {
      if (!input || typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.length > 160
        || typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) || input.email.length > 254
        || typeof input.password !== 'string' || input.password.length < 10 || input.password.length > 256
        || typeof input.phone !== 'string' || input.phone.length > 40 || /[\u0000-\u001f\u007f]/.test(input.phone)) {
        throw new ApiError('validation', 'invalid_registration');
      }
      await request('POST', '/auth/register-send-code', { anonymous: true, signal, timeoutMs: 20000,
        body: { name: input.name.trim(), email: input.email.trim().toLowerCase(), password: input.password, phone: input.phone.trim() } });
    },
    async verifyRegistration(email: string, code: string, signal?: AbortSignal) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !/^\d{6}$/.test(code)) throw new ApiError('validation', 'invalid_verification_code');
      return credentials(await request('POST', '/auth/verify-and-register', { anonymous: true, signal, timeoutMs: 20000,
        body: { email: email.trim().toLowerCase(), code } }));
    },
    async session(signal?: AbortSignal) {
      return normalizeUser(object(await request('GET', '/auth/session', { signal, timeoutMs: 20000 })).user);
    },
    async logout(token: string, signal?: AbortSignal) {
      await request('POST', '/auth/logout', { token, signal, timeoutMs: 20000 });
    }
  };
  const getHotelStatic = async (hid: number, language: Language = 'en', signal?: AbortSignal) => {
    if (hotelId(hid) === null || !['ar', 'en', 'es'].includes(language)) throw new ApiError('validation', 'invalid_hotel');
    const data = object(await request('GET', `/v1/hotels/${hid}`, { signal, query: { language }, timeoutMs: 20000 }));
    if (!data.hotel || Array.isArray(data.hotel) || typeof data.hotel !== 'object') throw invalidResponse();
    return object(data.hotel);
  };
  return {
    checkout: createCheckoutApi(request),
    auth, getHotelStatic,
    saveMembershipDetails: (details: MemberDetails, language: Language, token: string, signal: AbortSignal) =>
      request('PUT', '/membership/application', { body: { ...details, language }, token, signal }),
    uploadMembershipDocument: (kind: DocumentKind, upload: DocumentUpload, token: string, signal: AbortSignal) =>
      request('PUT', '/membership/application/documents/' + kind, { upload, token, signal, timeoutMs: 60000 }),
    submitMembership: (token: string, signal: AbortSignal) =>
      request('POST', '/membership/application/submit', { body: { consent: true }, token, signal }),
    getNotices: (signal?: AbortSignal) => ownedNotices(request, signal),
    getMembershipStatus: (signal?: AbortSignal) => membershipStatus(request, signal),
    async verifyPrivateRateAccess(signal: AbortSignal) { await requireMemberRateAccess(request, { signal }); },
    getBookings: (signal?: AbortSignal) => getOwnedBookings(request, signal),
    getAccountDeletionRequest: (signal?: AbortSignal) => getAccountDeletionRequest(request, signal),
    requestAccountDeletion: (password: string, signal?: AbortSignal) => requestAccountDeletion(request, password, signal),
    async searchSuggestions(query: string, language: Language = 'en', signal?: AbortSignal) {
      if (!query.trim() || query.trim().length > 160 || !['ar', 'en', 'es'].includes(language)) throw new ApiError('validation', 'invalid_query');
      return normalizeSuggestions(await request('GET', '/search/suggest', { signal, timeoutMs: 20000,
        query: { query: query.trim(), language: 'en', display_language: language } }));
    },
    async searchHotels(criteria: SearchCriteria, signal?: AbortSignal) {
      assertCriteria(criteria);
      let payload: unknown;
      try {
        payload = await request('POST', criteria.regionId ? '/search/rates/region' : '/search/rates', { signal,
          body: { ...searchBody(criteria), ...(criteria.regionId ? { region_id: criteria.regionId } : { hids: criteria.hids }),
            response_view: 'mobile_cards_v1' } });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404 && error.code === 'HOTELS_NOT_FOUND') return [];
        throw error;
      }
      const rows = object(payload).hotels;
      if (!Array.isArray(rows)) throw invalidResponse();
      return rows.map(hotel => normalizeHotel(hotel, criteria.currency));
    },
    async getHotel(hid: number, criteria: SearchCriteria, language: Language = 'en', signal?: AbortSignal) {
      if (hotelId(hid) === null || !['ar', 'en', 'es'].includes(language)) throw new ApiError('validation', 'invalid_hotel');
      const input = { ...criteria, regionId: undefined, hids: [hid], language };
      assertCriteria(input);
      const controller = new AbortController();
      const cancel = () => controller.abort();
      if (signal?.aborted) controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const [content, page] = await Promise.all([
          getHotelStatic(hid, language, controller.signal).catch(error => {
            if (error instanceof ApiError && error.status === 404) return {};
            throw error;
          }),
          request('POST', '/search/hotelpage', { signal: controller.signal, body: { ...searchBody(input), hid } })
        ]);
        return normalizeDetails(hid, content, page, criteria.currency);
      } catch (error) { controller.abort(); throw error; }
      finally { signal?.removeEventListener('abort', cancel); }
    },
    async prebook(hid: number, offer: RoomOffer, signal?: AbortSignal): Promise<PrebookResult> {
      if (hotelId(hid) === null || !offer.bookHash?.startsWith('h-') || !offer.offerContext
        || offer.offerContext.length > 131072) throw new ApiError('validation', 'fresh_hotelpage_required');
      const data = object(await request('POST', '/booking/prebook', { signal,
        body: { hash: offer.bookHash, offer_context: offer.offerContext } }));
      const hotels = data.hotels;
      if (!Array.isArray(hotels) || hotels.length !== 1 || hotelId(object(hotels[0]).hid) !== hid) throw invalidResponse();
      const rates = object(hotels[0]).rates;
      if (!Array.isArray(rates) || rates.length !== 1) throw invalidResponse();
      const next = normalizeOffers(rates)[0];
      if (!next || next.name !== offer.name || !next.bookHash.startsWith('p-') || !next.price
        || offer.roomIdentity && next.roomIdentity !== offer.roomIdentity
        || typeof data.prebook_context !== 'string' || !data.prebook_context || data.prebook_context.length > 131072
        || /[\u0000-\u0020\u007f]/.test(data.prebook_context)) throw invalidResponse();
      const priceChanged = object(data.changes).price_changed === true || !offer.price
        || next.price.currency !== offer.price.currency || !sameAmount(next.price.amount, offer.price.amount);
      return { offer: { ...next, images: next.roomIdentity && next.roomIdentity === offer.roomIdentity ? [...offer.images] : next.images },
        priceChanged, prebookContext: data.prebook_context };
    }
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
