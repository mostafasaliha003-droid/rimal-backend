import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { AppEnvironment, TokenStorage } from '../types';
import { ApiError } from '../api/errors';

export function createTokenStorage(environment: AppEnvironment): TokenStorage {
  const key = `remal.mobile.auth.${environment}.v1`;
  // The browser preview intentionally has no persistent authentication or PII.
  // Native SecureStore failures never fall back to unencrypted storage.
  if (Platform.OS === 'web') {
    let token: string | null = null;
    return { async get() { return token; }, async set(value) { token = value; }, async clear() { token = null; } };
  }
  return {
    async get() { try { return await SecureStore.getItemAsync(key); } catch { throw new ApiError('storage', 'secure_storage_unavailable'); } },
    async set(value) { try { await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); }
      catch { throw new ApiError('storage', 'secure_storage_unavailable'); } },
    async clear() { try { await SecureStore.deleteItemAsync(key); } catch { throw new ApiError('storage', 'secure_storage_unavailable'); } }
  };
}
