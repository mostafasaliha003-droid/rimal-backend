const PRODUCTION_API_BASE_URL = 'https://rimal-api.onrender.com/api';
const STAGING_API_BASE_URL = 'https://rimal-api-staging.onrender.com/api';
// Hosts where the API serves the website itself, so the site uses its own origin's /api.
const SAME_ORIGIN_SITES = new Set(['https://pillowstays.app', 'https://www.pillowstays.app', 'https://rimal-api-staging.onrender.com']);

export function resolveApiBaseUrl({ production = false, mode, configuredUrl = '', origin } = {}) {
    const configuredApiBaseUrl = String(configuredUrl).replace(/\/+$/, '');
    if (SAME_ORIGIN_SITES.has(origin)) return '/api';
    if (mode === 'staging' && configuredApiBaseUrl === STAGING_API_BASE_URL) return STAGING_API_BASE_URL;
    return production ? PRODUCTION_API_BASE_URL : '/api';
}

// Staging is enabled only by an explicit staging build and an exact allowlisted
// API URL. The Staging API also serves a fallback copy of the frontend; use its
// same-origin API even when that fallback was built in production mode.
const environment = import.meta.env ?? {};
export const API_BASE_URL = resolveApiBaseUrl({
    production: environment.PROD,
    mode: environment.MODE,
    configuredUrl: environment.VITE_API_BASE_URL,
    origin: typeof window !== 'undefined' ? window.location.origin : undefined
});
