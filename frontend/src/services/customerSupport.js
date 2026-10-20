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
export async function supportDocument({ conversationId, reference, kind, staff, signal }) {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(reference) || !['voucher', 'cancellation'].includes(kind)) throw new Error('document_unavailable');
    const token = staff ? sessionStorage.getItem(STAFF_TOKEN_KEY) : userAccessToken();
    const route = kind === 'voucher' ? staff ? `/owned/admin/bookings/${encodeURIComponent(reference)}/pdf` : `/owned/bookings/pdf/${encodeURIComponent(reference)}`
        : staff ? `/v1/admin/support/conversations/${encodeURIComponent(conversationId)}/cancellation-receipt` : `/owned/bookings/${encodeURIComponent(reference)}/cancellation/receipt`;
    const response = await fetch(`${API_BASE_URL}${route}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf')) throw new Error('document_unavailable');
    const blob = await response.blob();
    if (blob.size > 25 * 1024 * 1024 || !(await blob.slice(0, 5).text()).startsWith('%PDF-')) throw new Error('document_unavailable');
    return blob;
}
