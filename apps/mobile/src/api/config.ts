import type { AppEnvironment } from '../types';
import { ApiError } from './errors';

export function resolveEnvironment(value: unknown): AppEnvironment {
  if (value === undefined || value === null || value === '' || value === 'staging') return 'staging';
  if (value === 'production') return 'production';
  throw new ApiError('configuration', 'invalid_app_environment');
}
// This is an environment name, never a caller-provided backend URL or API key.
export const APP_ENV = resolveEnvironment(process.env.EXPO_PUBLIC_API_ENV);
export function endpoints(environment: AppEnvironment) {
  const env = resolveEnvironment(environment);
  return env === 'production'
    ? { api: 'https://rimal-api.onrender.com/api', website: 'https://remalbookings.com' }
    : { api: 'https://rimal-api-staging.onrender.com/api', website: 'https://rimal-api-staging.onrender.com' };
}
