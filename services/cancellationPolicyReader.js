// Only the read-only supplier lookup is retried. Cancellation submissions always
// recheck the supplier policy independently and never use this pending result.
function createCancellationPolicyReader(read, { waitMs = 6000, retryMs = 1000, now = Date.now } = {}) {
    const pending = new Map();
    const transient = error => ['order_info_unavailable', 'request_failed', 'timeout', 'internal_error'].includes(error?.code);
    return async reference => {
        for (const [key, value] of pending) {
            if (value.finishedAt && now() - value.finishedAt > 15000) pending.delete(key);
        }
        let entry = pending.get(reference);
        if (!entry) {
            if (pending.size >= 200) throw Object.assign(new Error('cancellation_busy'), { code: 'cancellation_busy', httpStatus: 503 });
            entry = {};
            entry.task = (async () => {
                try { return { value: await read(reference) }; }
                catch (error) {
                    if (!transient(error)) return { error };
                    await new Promise(resolve => setTimeout(resolve, retryMs));
                    try { return { value: await read(reference) }; } catch (failure) { return { error: failure }; }
                }
            })().then(result => { entry.finishedAt = now(); return result; });
            pending.set(reference, entry);
        }
        let timer;
        try {
            const result = await Promise.race([entry.task,
                new Promise(resolve => { timer = setTimeout(() => resolve(null), waitMs); })]);
            if (!result) return { checking: true, retry_after_ms: 3000 };
            if (pending.get(reference) === entry) pending.delete(reference);
            if (result.error) throw result.error;
            return result.value;
        } finally { clearTimeout(timer); }
    };
}
module.exports = { createCancellationPolicyReader };
