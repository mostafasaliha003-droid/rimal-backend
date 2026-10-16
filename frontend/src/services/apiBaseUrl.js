const PRODUCTION_API_BASE_URL = 'https://rimal-api.onrender.com/api';
const STAGING_API_BASE_URL = 'https://rimal-api-staging.onrender.com/api';

const configuredApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const isStagingBuild = import.meta.env.MODE === 'staging';
const servedByStagingApi = typeof window !== 'undefined'
    && window.location.origin === 'https://rimal-api-staging.onrender.com';

// Staging is enabled only by an explicit staging build and an exact allowlisted
// API URL. The Staging API also serves a fallback copy of the frontend; use its
// same-origin API even when that fallback was built in production mode.
export const API_BASE_URL = servedByStagingApi
    ? '/api'
    : isStagingBuild && configuredApiBaseUrl === STAGING_API_BASE_URL
        ? STAGING_API_BASE_URL
        : import.meta.env.PROD ? PRODUCTION_API_BASE_URL : '/api';
