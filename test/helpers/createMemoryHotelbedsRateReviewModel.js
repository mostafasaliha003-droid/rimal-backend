function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function matchesValue(actual, expected) {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)
        && !(expected instanceof Date)) {
        if (Object.hasOwn(expected, '$gt')) return actual instanceof Date
            && actual.getTime() > new Date(expected.$gt).getTime();
        if (Object.hasOwn(expected, '$gte')) return actual instanceof Date
            && actual.getTime() >= new Date(expected.$gte).getTime();
        if (Object.hasOwn(expected, '$lt')) return actual instanceof Date
            && actual.getTime() < new Date(expected.$lt).getTime();
        if (Object.hasOwn(expected, '$lte')) return actual instanceof Date
            && actual.getTime() <= new Date(expected.$lte).getTime();
    }
    if (actual instanceof Date || expected instanceof Date) {
        return actual instanceof Date && expected instanceof Date
            && actual.getTime() === expected.getTime();
    }
    return actual === expected;
}

function createMemoryHotelbedsRateReviewModel() {
    const records = new Map();
    let operationHook = null;

    function setOperationHook(hook) {
        if (hook !== null && typeof hook !== 'function') {
            throw new TypeError('memory_rate_review_hook_invalid');
        }
        operationHook = hook;
    }

    async function runHook(operation, context) {
        if (operationHook) await operationHook(operation, context);
    }

    function findRecord(filter) {
        return [...records.values()].find(record => Object.entries(filter || {})
            .every(([key, value]) => matchesValue(record[key], value))) || null;
    }

    function query(executor) {
        return {
            select() { return this; },
            lean() { return this; },
            exec: executor
        };
    }

    return {
        records,
        setOperationHook,
        async create(documents) {
            if (!Array.isArray(documents) || documents.length !== 1) {
                throw new TypeError('memory_rate_review_create_requires_one_document');
            }
            const document = clone(documents[0]);
            const duplicate = [...records.values()].some(record =>
                record.realm === document.realm
                && record.environment === document.environment
                && record.accountId === document.accountId
                && record.ownerSubject === document.ownerSubject
                && record.idempotencyKeyHash === document.idempotencyKeyHash);
            if (duplicate) throw Object.assign(new Error('duplicate rate review idempotency key'), { code: 11000 });
            await runHook('create', { document: clone(document) });
            const duplicateAfterHook = [...records.values()].some(record =>
                record.realm === document.realm
                && record.environment === document.environment
                && record.accountId === document.accountId
                && record.ownerSubject === document.ownerSubject
                && record.idempotencyKeyHash === document.idempotencyKeyHash);
            if (duplicateAfterHook) {
                throw Object.assign(new Error('duplicate rate review idempotency key'), { code: 11000 });
            }
            records.set(document.reviewId, document);
            return [clone(document)];
        },
        findOne(filter) {
            return query(async () => {
                const record = findRecord(filter);
                await runHook('findOne', { filter: clone(filter), record: clone(record) });
                return clone(record);
            });
        },
        findOneAndUpdate(filter, update, options = {}) {
            return query(async () => {
                const observed = findRecord(filter);
                await runHook('findOneAndUpdate', {
                    filter: clone(filter), update: clone(update), record: clone(observed)
                });
                // Re-evaluate after any awaited hook so concurrent calls model a
                // MongoDB compare-and-set rather than mutating a stale match.
                const record = findRecord(filter);
                if (!record) return null;
                const before = clone(record);
                if (update.$set) Object.assign(record, clone(update.$set));
                if (update.$inc) {
                    for (const [key, amount] of Object.entries(update.$inc)) {
                        record[key] = (record[key] || 0) + amount;
                    }
                }
                if (update.$unset) {
                    for (const key of Object.keys(update.$unset)) delete record[key];
                }
                return options.new === true || options.returnDocument === 'after'
                    ? clone(record) : before;
            });
        }
    };
}

module.exports = { createMemoryHotelbedsRateReviewModel };