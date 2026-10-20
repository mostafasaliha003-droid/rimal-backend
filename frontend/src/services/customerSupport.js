import { API_BASE_URL } from './apiBaseUrl';
import { userAccessToken } from './authSession';
export const STAFF_TOKEN_KEY = 'rimal_admin_access_token';
export async function supportRequest(path, { staff = false, method = 'GET', body, auth = false } = {}) {
    const token = staff ? sessionStorage.getItem(STAFF_TOKEN_KEY) : userAccessToken();
    const response = await fetch(`${API_BASE_URL}${auth ? '/v1/admin' : staff ? '/v1/admin/support' : '/support'}${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000), cache: 'no-store'
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || 'support_unavailable'), { status: response.status });
    return data;
}
