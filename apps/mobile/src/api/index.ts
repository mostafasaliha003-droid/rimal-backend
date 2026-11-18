import { APP_ENV } from './config';
import { withMemberRates } from './membership';
import { createTransport } from './transport';
import { createApiClient } from './client';
import { createTokenStorage } from '../auth/storage';
import { createSessionManager, type SessionManager } from '../auth/session';

let manager: SessionManager;
const request = createTransport({ environment: APP_ENV, getToken: () => manager.getToken(), onUnauthorized: token => manager.invalidate(token) });
export const api = createApiClient(withMemberRates(request));
manager = createSessionManager(api.auth, createTokenStorage(APP_ENV));
export const authSession = manager;
export { APP_ENV, endpoints } from './config';
export { ApiError, asApiError } from './errors';
export { bookingWebsiteUrl, websiteUrl } from './links';
export { COUNTRY_CODES, validateSearchCriteria } from './validation';
