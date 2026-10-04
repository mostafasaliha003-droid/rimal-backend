const HotelbedsBookingAttempt = require('../models/HotelbedsBookingAttempt');
const hotelbedsMockDatabase = require('./hotelbedsMockDatabase');
const { hotelbedsScopeFrom, ownerSubjectFrom } = require('./hotelbedsScope');
const { validOfferTermsVersion } = require('./offerTermsVersion');

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

    function trustedContext(ownerSubject, { allowAnyOwner = false } = {}) {
        let resolvedOwner;
        try { resolvedOwner = allowAnyOwner ? undefined : ownerSubjectFrom(ownerSubject, { testOnly }); }
        catch (error) { throw fail(error.code || 'hotelbeds_booking_owner_invalid', error.httpStatus || 401, error); }
        let scope;
        try { scope = hotelbedsScopeFrom(env, { testOnly }); }
        catch (error) { throw fail(error.code || 'hotelbeds_booking_scope_unavailable', 503, error); }
        return { ...scope, ...(allowAnyOwner ? {} : { ownerSubject: resolvedOwner }) };
    }

    async function claim(attempt) {
        const validOfferId = typeof attempt?.publicOfferId === 'string'
            && /^[a-f\d]{64}$/i.test(attempt.publicOfferId);
        const validScope = attempt?.scope === 'direct' && validOfferId && attempt.sessionId === undefined
            || attempt?.scope === 'prepaid' && validOfferId
                && typeof attempt.sessionId === 'string'
                && /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(attempt.sessionId);
        if (!validScope || !validOfferTermsVersion(attempt?.acceptedTermsVersion)
            || !(attempt?.termsAcceptedAt instanceof Date) || Number.isNaN(attempt.termsAcceptedAt.getTime())) {
            throw fail('hotelbeds_booking_attempt_claim_invalid', 400);
        }
        const context = trustedContext(attempt?.ownerSubject);
        if (attempt.provider !== 'hotelbeds' || attempt.origin !== 'live') {
            throw fail('hotelbeds_booking_fixture_forbidden', 409);
        }
        if (attempt?.realm !== undefined && attempt.realm !== context.realm
            || attempt?.environment !== undefined && attempt.environment !== context.environment
            || attempt?.accountId !== undefined && attempt.accountId !== context.accountId) {
            throw fail('hotelbeds_booking_scope_mismatch', 409);
        }
        await ensureReady();
        try {
            const created = await Model.create([{ ...attempt, ...context, provider: 'hotelbeds', origin: 'live' }], {
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

    async function getByOfferId(publicOfferId, ownerSubject, { allowAnyOwner = false } = {}) {
        const context = trustedContext(ownerSubject, { allowAnyOwner });
        await ensureReady();
        return Model.findOne({ scope: 'direct', publicOfferId, realm: context.realm,
            environment: context.environment, accountId: context.accountId,
            origin: 'live', provider: 'hotelbeds',
            ...(!allowAnyOwner ? { ownerSubject: context.ownerSubject } : {}) })
            .select('+scope +realm +environment +accountId +ownerSubject +sessionId +attemptId +clientReference +rateKey +rateType +rateIdentity +rateTerms '
                + '+acceptedTermsVersion +termsAcceptedAt +bookingReference +bookingStatus +lastError +bookingRateKey +bookingRecordPayloadEncrypted')
            .lean().exec();
    }

    async function getBySessionId(sessionId, ownerSubject, { allowAnyOwner = false } = {}) {
        const context = trustedContext(ownerSubject, { allowAnyOwner });
        await ensureReady();
        return Model.findOne({ scope: 'prepaid', sessionId, realm: context.realm,
            environment: context.environment, accountId: context.accountId,
            origin: 'live', provider: 'hotelbeds',
            ...(!allowAnyOwner ? { ownerSubject: context.ownerSubject } : {}) })
            .select('+scope +realm +environment +accountId +ownerSubject +sessionId +publicOfferId +attemptId +clientReference +rateKey +rateType +rateIdentity +rateTerms '
                + '+acceptedTermsVersion +termsAcceptedAt +bookingReference +bookingStatus +lastError +bookingRateKey +bookingRecordPayloadEncrypted')
            .lean().exec();
    }

    async function getByClientReference(clientReference, { ownerSubject, allowAnyOwner = false } = {}) {
        const context = trustedContext(ownerSubject, { allowAnyOwner });
        await ensureReady();
        return Model.findOne({ clientReference, realm: context.realm,
            environment: context.environment, accountId: context.accountId,
            origin: 'live', provider: 'hotelbeds',
            ...(!allowAnyOwner ? { ownerSubject: context.ownerSubject } : {}) })
            .select('+scope +realm +environment +accountId +ownerSubject +sessionId +publicOfferId +attemptId +clientReference +rateKey +rateType +rateIdentity +rateTerms '
                + '+bookingReference +bookingStatus +lastError +bookingRateKey')
            .lean().exec();
    }

    async function transition({ attemptId, ownerSubject, expectedState, nextState, fields = {}, contextOperation = false } = {}) {
        if (typeof attemptId !== 'string' || !NEXT_STATES[expectedState]?.has(nextState)) {
            throw fail('hotelbeds_booking_attempt_transition_invalid', 409);
        }
        const context = trustedContext(ownerSubject, { allowAnyOwner: contextOperation });
        await ensureReady();
        if (['realm', 'environment', 'accountId', 'ownerSubject', 'provider', 'origin', 'attemptId', 'scope', 'publicOfferId', 'sessionId']
            .some(key => Object.hasOwn(fields, key))) {
            throw fail('hotelbeds_booking_attempt_transition_scope_mutation_forbidden', 409);
        }
        let updated;
        try {
            updated = await Model.findOneAndUpdate({ attemptId, ...context, state: expectedState }, {
                $set: { ...fields, state: nextState }
            }, { new: true, writeConcern: WRITE_CONCERN }).lean().exec();
        } catch (error) {
            throw fail('hotelbeds_booking_attempt_persistence_unknown', 503, error);
        }
        if (!updated) throw fail('hotelbeds_booking_attempt_state_conflict', 409);
        return updated;
    }

    return {
        claim, getByOfferId, getBySessionId, getByClientReference, transition,
        testOnly: testOnly === true
    };
}

module.exports = { WRITE_CONCERN, createHotelbedsBookingAttemptStore };