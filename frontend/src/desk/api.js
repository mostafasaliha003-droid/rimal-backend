import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Mkhadda Desk talks to /api/v1/desk with a staff session kept in sessionStorage only: closing the
 * window signs the staff member out, and nothing financial is ever cached on the device.
 */
const KEY = 'mkhadda_desk_session';

export const session = {
    get() { try { const value = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return value && /^[a-f\d]{64}$/i.test(value.token || '') ? value : null; } catch { return null; } },
    set(value) { sessionStorage.setItem(KEY, JSON.stringify(value)); },
    clear() { sessionStorage.removeItem(KEY); }
};

export class DeskError extends Error {
    constructor(code, status) { super(code); this.code = code; this.status = status; }
}

export async function call(url, { method = 'GET', body, signal } = {}) {
    const current = session.get();
    const response = await fetch(url, {
        method, signal, cache: 'no-store', credentials: 'omit',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(current ? { Authorization: `Bearer ${current.token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await response.json(); } catch { /* empty body */ }
    if (response.status === 401 && current) { session.clear(); window.dispatchEvent(new Event('desk:signed-out')); }
    if (!response.ok || data.success === false) throw new DeskError(typeof data.error === 'string' ? data.error : 'request_failed', response.status);
    return data;
}

export const desk = (path, options) => call(`/api/v1/desk${path}`, options);
export const care = (path, options) => call(`/api/v1/desk/care/support${path}`, options);

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));

/**
 * Live data: loads, then reloads every `every` ms while the window is visible (and at once when it
 * comes back). Keeps the last good value on a failed refresh and says when it was last updated.
 */
export function useLive(load, deps, every = 30000) {
    const [state, setState] = useState({ data: null, error: null, at: null, loading: true });
    const loader = useRef(load);
    loader.current = load;
    const run = useCallback(async signal => {
        try {
            const data = await loader.current(signal);
            if (!signal?.aborted) setState({ data, error: null, at: new Date(), loading: false });
        } catch (error) {
            if (!signal?.aborted && error.name !== 'AbortError') setState(prev => ({ ...prev, error, loading: false }));
        }
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        setState(prev => ({ ...prev, loading: true }));
        run(controller.signal);
        let timer = every ? setInterval(() => { if (document.visibilityState === 'visible') run(controller.signal); }, every) : null;
        const wake = () => { if (document.visibilityState === 'visible') run(controller.signal); };
        document.addEventListener('visibilitychange', wake);
        return () => { controller.abort(); if (timer) clearInterval(timer); timer = null; document.removeEventListener('visibilitychange', wake); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return { ...state, reload: () => run() };
}
