const events = new Set(['search_started', 'search_completed', 'search_failed', 'room_selected', 'checkout_started', 'payment_started', 'payment_failed']);
const numericFields = new Set(['result_count', 'duration_ms', 'room_count', 'guest_count']);

export function trackBookingEvent(name, values = {}) {
    if (!events.has(name) || typeof window === 'undefined') return;
    const properties = Object.fromEntries(Object.entries(values).filter(([key, value]) => numericFields.has(key) && Number.isFinite(value) && value >= 0));
    window.dispatchEvent(new CustomEvent('remal:analytics', { detail: { name, properties, timestamp: Date.now() } }));
}