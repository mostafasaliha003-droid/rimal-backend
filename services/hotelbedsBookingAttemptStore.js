const HotelbedsBookingAttempt = require('../models/HotelbedsBookingAttempt');
const hotelbedsMockDatabase = require('./hotelbedsMockDatabase');

const WRITE_CONCERN = Object.freeze({ w: 'majority', j: true, wtimeout: 10000 });
const NEXT_STATES = Object.freeze({
    claimed: new Set(['preflight_failed', 'booking_processing']),
    preflight_failed: new Set(),
    booking_processing: new Set(['confirmed', 'booking_pending', 'outcome_unknown']),
    booking_pending: new Set(['confirmed', 'manual_review']),
    confirmed: new Set(),
    outcome_unknown: new Set(['confirmed', 'booking_pending', 'manual_review']),
    manual_review: new Set()
});

function fail(code, httpStatus = 503, cause) {
    return Object.assign(new Error(code), { code, httpStatus, ...(cause ? { cause } : {}) });
}

function createHotelbedsBookingAttemptStore({
    Model = HotelbedsBookingAttempt,
    database = hotelbedsMockDatabase,
    env = process.env,
    testOnly = false,
    ensureDatabaseReady: testEnsureDatabaseReady
} = {}) {
    if (!Model || typeof Model.create !== 'function' || typeof Model.findOne !== 'function'
        || typeof Model.findOneAndUpdate !== 'function' || !database
        || testOnly && typeof testEnsureDatabaseReady !== 'function'
        || testOnly && process.env.NODE_ENV === 'production'
        || !testOnly && testEnsureDatabaseReady !== undefined) {
        throw new TypeError('hotelbeds_booking_attempt_store_dependencies_invalid');
    }

    let readyPromise;
    async function ensureReady() {
        if (testOnly) {
            await testEnsureDatabaseReady();
            return;
        }
        if (!readyPromise) {
            readyPromise = Promise.resolve().then(async () => {
                await database.ensureModelConnected(Model, {
                    env,
                    expectedConnection: database.connection,
                    errorCode: 'hotelbeds_booking_attempt_database_unavailable'
                });
                if (typeof Model.init !== 'function') throw new Error('model_indexes_unavailable');
                await Model.init();
            }).catch(error => {
                readyPromise = null;
                throw fail('hotelbeds_booking_attempt_database_unavailable', 503, error);
            });
        }
        await readyPromise;
    }

    async function claim(attempt) {
        const validOfferId = typeof attempt?.publicOfferId === 'string'
            && /^[a-f\d]{64}$/i.test(attempt.publicOfferId);
        const validScope = attempt?.scope === 'direct' && validOfferId && attempt.sessionId === undefined
            || attempt?.scope === 'prepaid' && validOfferId
                && typeof attempt.sessionId === 'string'
                && /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(attempt.sessionId);
        if (!validScope) throw fail('hotelbeds_booking_attempt_claim_invalid', 400);
        await ensureReady();
        try {
            const created = await Model.create([attempt], {
                ordered: true,
                writeConcern: WRITE_CONCERN
            });
            if (!Array.isArray(created) || created.length !== 1) {
                throw new Error('hotelbeds_booking_attempt_create_incomplete');
            }
            return created[0];
        } catch (error) {
            if (error?.code === 11000) return null;
            throw fail('hotelbeds_booking_attempt_claim_unavailable', 503, error);
        }
    }

    async function getByOfferId(publicOfferId) {
        await ensureReady();
        return Model.findOne({ scope: 'direct', publicOfferId })
            .select('+scope +sessionId +attemptId +clientReference +rateKey +rateType +rateIdentity +rateTerms '
                + '+bookingReference +bookingStatus +lastError +bookingRateKey')
            .lean().exec();
    }

    async function getBySessionId(sessionId) {
        await ensureReady();
        return Model.findOne({ scope: 'prepaid', sessionId })
            .select('+scope +sessionId +publicOfferId +attemptId +clientReference +rateKey +rateType +rateIdentity +rateTerms '
                + '+bookingReference +bookingStatus +lastError +bookingRateKey')
            .lean().exec();
    }

    async function getByClientReference(clientReference) {
        await ensureReady();
        return Model.findOne({ clientReference })
            .select('+scope +sessionId +publicOfferId +attemptId +clientReference +rateKey +rateType +rateIdentity +rateTerms '
                + '+bookingReference +bookingStatus +lastError +bookingRateKey')
            .lean().exec();
    }

    async function transition({ attemptId, expectedState, nextState, fields = {} } = {}) {
        if (typeof attemptId !== 'string' || !NEXT_STATES[expectedState]?.has(nextState)) {
            throw fail('hotelbeds_booking_attempt_transition_invalid', 409);
        }
        await ensureReady();
        let updated;
        try {
            updated = await Model.findOneAndUpdate({ attemptId, state: expectedState }, {
                $set: { ...fields, state: nextState }
            }, { new: true, writeConcern: WRITE_CONCERN }).lean().exec();
        } catch (error) {
            throw fail('hotelbeds_booking_attempt_persistence_unknown', 503, error);
        }
        if (!updated) throw fail('hotelbeds_booking_attempt_state_conflict', 409);
        return updated;
    }

    return {
        claim, getByOfferId, getBySessionId, getByClientReference, transition
    };
}

module.exports = { WRITE_CONCERN, createHotelbedsBookingAttemptStore };