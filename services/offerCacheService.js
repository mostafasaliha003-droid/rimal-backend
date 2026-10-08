const crypto = require('node:crypto');
const mongoose = require('mongoose');
const OfferCache = require('../models/OfferCache');
const hotelbedsMockDatabase = require('./hotelbedsMockDatabase');
const { identityFromNormalizedOffer, termsFromNormalizedOffer } = require('./hotelbedsRateCheckService');
const { hotelbedsScopeFrom } = require('./hotelbedsScope');
const { offerTermsVersion, validOfferTermsVersion } = require('./offerTermsVersion');

const OFFER_TTL_MS = 30 * 60 * 1000;

function fail(code, httpStatus = 400) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function requiredString(value, code, maxLength) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
        throw fail(code);
    }
    return value.trim();
}

function providerHotelCodeFrom(offer) {
    const value = offer.providerHotelId ?? offer.hotel?.providerHotelId ?? offer.hotel?.code;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
    if (typeof value === 'string' && value.trim() && value.trim().length <= 200) return value.trim();
    throw fail('offer_cache_provider_hotel_code_invalid');
}

function opaqueTokenFrom(offer) {
    return requiredString(offer.booking?.opaqueToken ?? offer.opaqueToken,
        'offer_cache_opaque_token_missing', 8192);
}

function lockedPriceFrom(offer) {
    const amount = offer.price?.supplierAmount?.amount;
    if (typeof amount !== 'string' || !/^\d+(?:\.\d+)?$/.test(amount.trim())) {
        throw fail('offer_cache_locked_price_invalid');
    }
    return amount.trim();
}

function currencyFrom(offer) {
    const currency = offer.price?.supplierAmount?.currency;
    if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency.trim())) {
        throw fail('offer_cache_currency_invalid');
    }
    return currency.trim().toUpperCase();
}

function lockedSellPriceFrom(offer) {
    const amount = offer.price?.customerDisplay?.amount;
    const currency = offer.price?.customerDisplay?.currency;
    if (typeof amount !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(amount.trim())
        || !/^[A-Za-z]{3}$/.test(String(currency || '').trim())) {
        return { amount: null, currency: null };
    }
    return { amount: amount.trim(), currency: currency.trim().toUpperCase() };
}

function nullableInteger(value, min, max) {
    return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function assertProvider(provider) {
    if (!['hotelbeds', 'ratehawk'].includes(provider)) throw fail('offer_cache_provider_invalid');
}

function pick(source, fields) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const result = {};
    for (const field of fields) {
        if (Object.hasOwn(source, field)) result[field] = source[field];
    }
    return result;
}

function publicCancellation(cancellation, provider) {
    if (!cancellation || typeof cancellation !== 'object' || Array.isArray(cancellation)) return null;
    const safeTimestamp = value => {
        const source = typeof value?.source === 'string' ? value.source : '';
        return value?.timezoneKnown === true && /(?:Z|[+-]\d{2}:\d{2})$/i.test(source)
            && typeof value?.utc === 'string' && Number.isFinite(Date.parse(value.utc))
            ? { source, utc: value.utc } : null;
    };
    return {
        refundability: cancellation.refundability ?? 'unknown',
        freeCancellationBefore: safeTimestamp(cancellation.freeCancellationBefore),
        schedule: Array.isArray(cancellation.schedule) && cancellation.schedule.length
            && cancellation.schedule.every(item => safeTimestamp(item?.startsAt))
            ? cancellation.schedule.slice(0, 30).map(item => {
                const displayable = provider !== 'hotelbeds'
                    ? Boolean(item?.displayAmount && item?.penalty?.currency)
                    : item?.penalty?.currency === 'AED'
                        && /^\d+(?:\.\d+)?$/.test(String(item?.penalty?.amount ?? ''));
                return {
                    startsAt: safeTimestamp(item.startsAt),
                    feeAmountDisplayable: displayable,
                    ...(displayable ? {
                        feeAmount: provider === 'hotelbeds' ? String(item.penalty.amount) : String(item.displayAmount),
                        currency: provider === 'hotelbeds' ? 'AED' : item.penalty.currency
                    } : {})
                };
            }) : []
    };
}

function publicRateComments(comments) {
    return Array.isArray(comments) ? comments.slice(0, 20).map(comment => {
        if (typeof comment === 'string') return comment.trim().slice(0, 2000);
        if (!comment || typeof comment !== 'object') return null;
        const description = typeof comment.description === 'string' ? comment.description.trim() : '';
        const dateStart = typeof comment.dateStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(comment.dateStart)
            ? comment.dateStart : null;
        const dateEnd = typeof comment.dateEnd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(comment.dateEnd)
            ? comment.dateEnd : null;
        if (!description) return null;
        return dateStart && dateEnd
            ? { description: description.slice(0, 2000), dateStart, dateEnd }
            : description.slice(0, 2000);
    }).filter(Boolean) : [];
}

function publicTaxes(taxes, provider) {
    if (!taxes || typeof taxes !== 'object' || Array.isArray(taxes)) return null;
    if (provider === 'hotelbeds') {
        return {
            status: taxes.status === 'provided' ? 'provided' : 'unknown',
            allIncluded: typeof taxes.allIncluded === 'boolean' ? taxes.allIncluded : null,
            items: Array.isArray(taxes.items) ? taxes.items.slice(0, 50).map(item => {
                const displayable = item?.clientCurrency === 'AED'
                    && /^\d+(?:\.\d+)?$/.test(String(item?.clientAmount ?? ''));
                return {
                    included: typeof item?.included === 'boolean' ? item.included : null,
                    type: typeof item?.type === 'string' ? item.type.slice(0, 100) : null,
                    subType: typeof item?.subType === 'string' ? item.subType.slice(0, 100) : null,
                    amount: displayable ? String(item.clientAmount) : null,
                    currency: displayable ? 'AED' : null,
                    amountDisplayable: displayable
                };
            }) : []
        };
    }
    return {
        status: taxes.status ?? null,
        allIncluded: typeof taxes.allIncluded === 'boolean' ? taxes.allIncluded : null,
        items: Array.isArray(taxes.items) ? taxes.items.map(item => pick(item, [
            'included', 'amount', 'currency', 'clientAmount', 'clientCurrency', 'type', 'subType'
        ])) : []
    };
}

function clientSafeOffer(offer, publicOfferId) {
    // Explicitly construct this DTO. Never spread a normalized supplier object:
    // it contains identifiers and the opaque checkout token in its private fields.
    return {
        schemaVersion: offer.schemaVersion ?? 1,
        provider: offer.provider,
        publicOfferId,
        hotel: {
            canonicalId: offer.hotel?.canonicalId ?? null,
            name: offer.hotel?.name ?? null,
            category: pick(offer.hotel?.category, ['code', 'name']),
            content: offer.hotel?.customerContent ? {
                description: typeof offer.hotel.customerContent.description === 'string'
                    ? offer.hotel.customerContent.description.slice(0, 4000) : null,
                images: Array.isArray(offer.hotel.customerContent.images)
                    ? offer.hotel.customerContent.images.slice(0, 12).map(image => ({
                        url: image.url, visualOrder: image.visualOrder
                    })) : [],
                roomImages: Array.isArray(offer.hotel.customerContent.roomImages)
                    ? offer.hotel.customerContent.roomImages.slice(0, 12).map(image => ({
                        url: image.url, visualOrder: image.visualOrder, roomCode: image.roomCode
                    })) : [],
                facilities: Array.isArray(offer.hotel.customerContent.facilities)
                    ? offer.hotel.customerContent.facilities.slice(0, 100) : [],
                issues: Array.isArray(offer.hotel.customerContent.issues)
                    ? offer.hotel.customerContent.issues.slice(0, 30) : []
            } : null,
            destinationCode: offer.hotel?.destinationCode ?? null,
            destinationName: offer.hotel?.destinationName ?? null
        },
        room: { name: offer.room?.name ?? null },
        stay: {
            checkIn: offer.stay?.checkIn ?? null,
            checkOut: offer.stay?.checkOut ?? null
        },
        occupancy: {
            rooms: offer.occupancy?.rooms ?? null,
            adults: offer.occupancy?.adults ?? null,
            children: offer.occupancy?.children ?? null
        },
        price: {
            customerDisplay: pick(offer.price?.customerDisplay, ['amount', 'currency'])
        },
        board: offer.board ? {
            supplierCode: offer.board.supplierCode ?? null,
            supplierName: offer.board.supplierName ?? null,
            normalizedCode: offer.board.normalizedCode ?? 'UNKNOWN'
        } : null,
        availability: offer.availability ? {
            rateType: offer.availability.rateType ?? null,
            rateClass: offer.availability.rateClass ?? null,
            allotment: offer.availability.allotment ?? null,
            packaging: offer.availability.packaging ?? null
        } : null,
        payment: offer.payment ? { type: offer.payment.type ?? null } : null,
        cancellation: publicCancellation(offer.cancellation, offer.provider),
        rateComments: publicRateComments(offer.rateComments),
        contractTerms: {
            rateCommentsResolved: offer.contractTerms?.rateCommentsResolved !== false,
            issues: Array.isArray(offer.contractTerms?.issues)
                ? offer.contractTerms.issues.filter(value => typeof value === 'string' && value.trim())
                    .map(value => value.trim().slice(0, 1000)).slice(0, 30) : [],
            mandatoryFacilities: Array.isArray(offer.contractTerms?.mandatoryFacilities)
                ? offer.contractTerms.mandatoryFacilities.slice(0, 100).map(item => ({
                    description: typeof item?.description === 'string' ? item.description.trim().slice(0, 300) : '',
                    fee: typeof item?.fee === 'boolean' ? item.fee : null,
                    amount: item?.fee === true && item.currency === 'AED'
                        && /^\d+(?:\.\d+)?$/.test(String(item.amount ?? '')) ? String(item.amount) : null,
                    currency: item?.fee === true && item.currency === 'AED'
                        && /^\d+(?:\.\d+)?$/.test(String(item.amount ?? '')) ? 'AED' : null
                })).filter(item => item.description) : []
        },
        taxes: publicTaxes(offer.taxes, offer.provider),
        promotions: Array.isArray(offer.promotions) ? offer.promotions.map(promotion =>
            pick(promotion, ['code', 'name', 'remark'])) : []
    };
}

function validPublicOfferId(value) {
    return typeof value === 'string' && /^[a-f\d]{64}$/i.test(value);
}

function createOfferCacheService({
    Model = OfferCache,
    now = () => new Date(),
    createPublicOfferId = () => crypto.randomBytes(32).toString('hex'),
    env = process.env,
    providerScope = Model === OfferCache ? 'shared' : 'hotelbeds',
    testOnly = false,
    sandboxConnection = hotelbedsMockDatabase.connection,
    ensureModelConnected = hotelbedsMockDatabase.ensureModelConnected,
    ensureDatabaseReady: testEnsureDatabaseReady
} = {}) {
    if (!['shared', 'hotelbeds', 'test'].includes(providerScope)
        || (providerScope === 'shared' && Model !== OfferCache)
        || (providerScope === 'hotelbeds' && Model === OfferCache)
        || (providerScope === 'test' && (testOnly !== true || typeof testEnsureDatabaseReady !== 'function'))
        || (testOnly && process.env.NODE_ENV === 'production')) {
        throw new TypeError('offer_cache_provider_scope_invalid');
    }
    if (typeof ensureModelConnected !== 'function') {
        throw new TypeError('offer_cache_database_dependency_invalid');
    }

    async function ensureDatabaseReady() {
        if (testOnly) {
            await testEnsureDatabaseReady();
            return;
        }
        const modelConnection = Model?.db;
        if (providerScope === 'hotelbeds') {
            await ensureModelConnected(Model, {
                env,
                errorCode: 'offer_cache_model_connection_mismatch',
                expectedConnection: sandboxConnection
            });
            return;
        }
        if (modelConnection === hotelbedsMockDatabase.connection) {
            throw fail('offer_cache_model_connection_mismatch', 503);
        }
        if (Model === OfferCache && modelConnection === mongoose.connection
            && modelConnection.readyState === 1) return;
        throw fail('offer_cache_database_unavailable', 503);
    }

    function assertProviderScope(provider) {
        if (testOnly) return;
        if ((providerScope === 'hotelbeds' && provider !== 'hotelbeds')
            || (providerScope === 'shared' && provider !== 'ratehawk')
            || (providerScope === 'hotelbeds' && Model.db !== sandboxConnection)) {
            throw fail('offer_cache_provider_scope_mismatch', 503);
        }
    }

    function trustedOriginFrom(offer) {
        if (!['live', 'mock_fixture'].includes(offer.origin)) {
            throw fail('offer_cache_origin_invalid', 503);
        }
        return offer.origin;
    }

    function bookingFilter(publicOfferId, extra = {}) {
        return {
            publicOfferId,
            ...(testOnly ? {} : { provider: 'hotelbeds', origin: { $exists: true } }),
            ...extra
        };
    }

    function providerFilter() {
        if (testOnly) return {};
        return { provider: providerScope === 'hotelbeds' ? 'hotelbeds' : 'ratehawk', origin: { $exists: true } };
    }

    function hotelbedsScope() {
        try { return hotelbedsScopeFrom(env, { testOnly }); }
        catch (error) { throw fail(error.code || 'offer_cache_scope_unavailable', 503); }
    }

    function offerScopeFilter(provider) {
        return providerScope === 'hotelbeds' || testOnly && provider === 'hotelbeds'
            ? hotelbedsScope() : {};
    }

    async function storeOffers(normalizedOffersArray, { schemaVersion } = {}) {
        if (!Array.isArray(normalizedOffersArray)) throw fail('offer_cache_offers_invalid');
        if (normalizedOffersArray.length === 0) return [];
        if (schemaVersion !== undefined && schemaVersion !== 1 && schemaVersion !== 2) {
            throw fail('offer_cache_schema_version_invalid');
        }

        const storedAt = new Date(now());
        if (Number.isNaN(storedAt.getTime())) throw fail('offer_cache_clock_invalid');
        const expiresAt = new Date(storedAt.getTime() + OFFER_TTL_MS);
        const seenIds = new Set();

        // Validate and build all operations first so invalid input cannot cause a
        // partial database write before the batch is checked.
        const prepared = normalizedOffersArray.map(input => {
            const offer = asObject(input);
            if (!offer) throw fail('offer_cache_offer_invalid');

            const provider = requiredString(offer.provider, 'offer_cache_provider_invalid', 32).toLowerCase();
            assertProvider(provider);
            assertProviderScope(provider);
            const recordSchemaVersion = schemaVersion ?? offer.schemaVersion ?? 1;
            if (recordSchemaVersion !== 1 && recordSchemaVersion !== 2) {
                throw fail('offer_cache_schema_version_invalid');
            }
            const publicOfferId = requiredString(createPublicOfferId(), 'offer_cache_public_id_invalid', 128);
            if (!/^[a-f\d]{64}$/i.test(publicOfferId) || seenIds.has(publicOfferId)) {
                throw fail('offer_cache_public_id_invalid');
            }
            seenIds.add(publicOfferId);
            const lockedSellPrice = lockedSellPriceFrom(offer);
            const bookingIdentity = provider === 'hotelbeds' ? identityFromNormalizedOffer(offer) : null;
            const bookingTerms = provider === 'hotelbeds' ? termsFromNormalizedOffer(offer) : null;
            const supplierScope = provider === 'hotelbeds' ? hotelbedsScope() : null;
            const bookingMetadata = provider === 'hotelbeds' ? {
                hotelName: typeof offer.hotel?.name === 'string' ? offer.hotel.name.slice(0, 200) : '',
                contentLanguage: offer.hotel?.contentSource === 'hotelbeds_content_api'
                    && String(offer.hotel?.contentHotelCode) === String(offer.providerHotelId)
                    && typeof offer.hotel?.contentLanguage === 'string'
                    && /^[A-Z]{2,12}$/i.test(offer.hotel.contentLanguage.trim())
                    ? offer.hotel.contentLanguage.trim().toUpperCase() : null,
                roomName: typeof offer.room?.name === 'string' ? offer.room.name.slice(0, 160) : '',
                boardName: typeof offer.board?.supplierName === 'string' ? offer.board.supplierName.slice(0, 120) : '',
                checkIn: typeof offer.stay?.checkIn === 'string' ? offer.stay.checkIn : '',
                checkOut: typeof offer.stay?.checkOut === 'string' ? offer.stay.checkOut : '',
                cancellationPolicy: publicCancellation(offer.cancellation, provider)?.refundability || 'unknown',
                paymentType: typeof offer.payment?.type === 'string'
                    ? offer.payment.type.trim().toUpperCase() : 'unknown'
            } : null;

            const publicOffer = {
                ...clientSafeOffer(offer, publicOfferId),
                schemaVersion: recordSchemaVersion
            };
            const publicReviewOffer = provider === 'hotelbeds'
                ? {
                    ...structuredClone(publicOffer),
                    termsVersion: offerTermsVersion(publicOffer)
                } : undefined;
            const termsVersion = provider === 'hotelbeds' ? offerTermsVersion(publicOffer) : null;

            return {
                document: {
                    schemaVersion: recordSchemaVersion,
                    origin: trustedOriginFrom(offer),
                    publicOfferId,
                    provider,
                    ...(termsVersion ? { termsVersion } : {}),
                    ...(supplierScope || {}),
                    ...(publicReviewOffer ? { publicReviewOffer } : {}),
                    ...(bookingMetadata ? { bookingMetadata } : {}),
                    providerHotelCode: providerHotelCodeFrom(offer),
                    opaqueToken: opaqueTokenFrom(offer),
                    lockedNetPrice: lockedPriceFrom(offer),
                    currency: currencyFrom(offer),
                    lockedSellAmount: lockedSellPrice.amount,
                    lockedSellCurrency: lockedSellPrice.currency,
                    paymentType: typeof offer.payment?.type === 'string'
                        ? offer.payment.type.trim().toUpperCase() : null,
                    rateType: ['BOOKABLE', 'RECHECK'].includes(offer.availability?.rateType)
                        ? offer.availability.rateType : null,
                    roomCount: nullableInteger(offer.occupancy?.rooms, 1, 9),
                    adultCount: nullableInteger(offer.occupancy?.adults, 1, 36),
                    childCount: nullableInteger(offer.occupancy?.children, 0, 36),
                    ...(bookingIdentity ? { bookingIdentity } : {}),
                    ...(bookingTerms ? { bookingTerms } : {}),
                    bookingState: 'available',
                    expiresAt
                },
                publicOffer: { ...publicOffer, ...(termsVersion ? { termsVersion } : {}) }
            };
        });

        await ensureDatabaseReady();
        const created = await Model.insertMany(prepared.map(item => item.document), { ordered: true });
        if (!Array.isArray(created) || created.length !== prepared.length) {
            throw fail('offer_cache_store_incomplete', 503);
        }
        return prepared.map(item => item.publicOffer);
    }

    async function retrieveOffer(publicOfferId) {
        if (!validPublicOfferId(publicOfferId)) throw fail('offer_cache_public_id_invalid', 404);
        const retrievedAt = new Date(now());
        if (Number.isNaN(retrievedAt.getTime())) throw fail('offer_cache_clock_invalid', 503);
        await ensureDatabaseReady();
        const record = await Model.findOne({
            publicOfferId,
            ...providerFilter(),
            expiresAt: { $gt: retrievedAt }
        }).select('+opaqueToken +lockedNetPrice +currency +origin').lean().exec();
        if (!record || record.origin === undefined) return null;

        return {
            publicOfferId: record.publicOfferId,
            provider: record.provider,
            providerHotelCode: record.providerHotelCode,
            opaqueToken: record.opaqueToken,
            lockedNetPrice: record.lockedNetPrice,
            currency: record.currency,
            expiresAt: new Date(record.expiresAt)
        };
    }

    async function getBookingOffer(publicOfferId) {
        if (providerScope !== 'hotelbeds' && !testOnly) {
            throw fail('offer_cache_provider_scope_mismatch', 503);
        }
        if (!validPublicOfferId(publicOfferId)) throw fail('offer_cache_public_id_invalid', 404);
        const retrievedAt = new Date(now());
        if (Number.isNaN(retrievedAt.getTime())) throw fail('offer_cache_clock_invalid', 503);
        await ensureDatabaseReady();
        const record = await Model.findOne({
            publicOfferId,
            ...providerFilter(),
            ...offerScopeFilter(),
            expiresAt: { $gt: retrievedAt }
        })
            .select([
                '+opaqueToken', '+lockedNetPrice', '+lockedSellAmount', '+lockedSellCurrency',
                '+currency', '+paymentType', '+rateType', '+origin',
                '+roomCount', '+adultCount', '+childCount', '+realm', '+environment', '+accountId',
                '+bookingIdentity', '+bookingTerms', '+bookingMetadata', '+publicReviewOffer', '+termsVersion'
            ].join(' ')).lean().exec();
        if (!record) return null;
        return {
            publicOfferId: record.publicOfferId,
            provider: record.provider,
            origin: record.origin,
            realm: record.realm,
            environment: record.environment,
            accountId: record.accountId,
            termsVersion: validOfferTermsVersion(record.termsVersion) ? record.termsVersion : null,
            opaqueToken: record.opaqueToken,
            providerHotelCode: record.providerHotelCode,
            lockedNetPrice: record.lockedNetPrice,
            currency: record.currency,
            paymentType: record.paymentType,
            rateType: record.rateType,
            roomCount: record.roomCount,
            adultCount: record.adultCount,
            childCount: record.childCount,
            bookingIdentity: record.bookingIdentity || null,
            bookingTerms: record.bookingTerms || null,
            bookingMetadata: record.bookingMetadata || null,
            publicReviewOffer: record.publicReviewOffer || null,
            lockedSellAmount: record.lockedSellAmount,
            lockedSellCurrency: record.lockedSellCurrency,
            expiresAt: new Date(record.expiresAt)
        };
    }

    async function getCheckoutOffer(publicOfferId) {
        if (providerScope !== 'hotelbeds' && !testOnly) {
            throw fail('offer_cache_provider_scope_mismatch', 503);
        }
        if (!validPublicOfferId(publicOfferId)) throw fail('offer_cache_public_id_invalid', 404);
        const retrievedAt = new Date(now());
        if (Number.isNaN(retrievedAt.getTime())) throw fail('offer_cache_clock_invalid', 503);
        await ensureDatabaseReady();
        const record = await Model.findOne({
            publicOfferId,
            ...providerFilter(),
            ...offerScopeFilter(),
            expiresAt: { $gt: retrievedAt }
        })
            .select([
                '+opaqueToken', '+lockedNetPrice', '+currency', '+lockedSellAmount', '+lockedSellCurrency',
                '+paymentType', '+rateType', '+roomCount', '+adultCount', '+childCount', '+origin',
                '+realm', '+environment', '+accountId', '+bookingIdentity', '+bookingTerms', '+termsVersion'
            ].join(' ')).lean().exec();
        if (!record || record.origin === undefined) return null;
        return {
            publicOfferId: record.publicOfferId,
            provider: record.provider,
            origin: record.origin,
            realm: record.realm,
            environment: record.environment,
            accountId: record.accountId,
            termsVersion: validOfferTermsVersion(record.termsVersion) ? record.termsVersion : null,
            providerHotelCode: record.providerHotelCode,
            opaqueToken: record.opaqueToken,
            lockedNetPrice: record.lockedNetPrice,
            currency: record.currency,
            lockedSellAmount: record.lockedSellAmount,
            lockedSellCurrency: record.lockedSellCurrency,
            paymentType: record.paymentType,
            rateType: record.rateType,
            roomCount: record.roomCount,
            adultCount: record.adultCount,
            childCount: record.childCount,
            bookingIdentity: record.bookingIdentity || null,
            bookingTerms: record.bookingTerms || null,
            expiresAt: new Date(record.expiresAt)
        };
    }

    async function getRateReviewOffer(publicOfferId) {
        if (providerScope !== 'hotelbeds' && !testOnly) {
            throw fail('offer_cache_provider_scope_mismatch', 503);
        }
        if (!validPublicOfferId(publicOfferId)) throw fail('offer_cache_public_id_invalid', 404);
        const retrievedAt = new Date(now());
        if (Number.isNaN(retrievedAt.getTime())) throw fail('offer_cache_clock_invalid', 503);
        await ensureDatabaseReady();
        const record = await Model.findOne({
            publicOfferId,
            ...providerFilter(),
            ...offerScopeFilter(),
            expiresAt: { $gt: retrievedAt }
        }).select([
            '+opaqueToken', '+lockedNetPrice', '+lockedSellAmount', '+lockedSellCurrency', '+currency',
            '+paymentType', '+rateType', '+origin', '+roomCount', '+adultCount', '+childCount',
            '+realm', '+environment', '+accountId', '+bookingIdentity', '+bookingTerms',
            '+publicReviewOffer', '+termsVersion'
        ].join(' ')).lean().exec();
        if (!record) return null;
        return {
            publicOfferId: record.publicOfferId,
            provider: record.provider,
            origin: record.origin,
            realm: record.realm,
            environment: record.environment,
            accountId: record.accountId,
            termsVersion: validOfferTermsVersion(record.termsVersion) ? record.termsVersion : null,
            opaqueToken: record.opaqueToken,
            lockedNetPrice: record.lockedNetPrice,
            currency: record.currency,
            paymentType: record.paymentType,
            rateType: record.rateType,
            roomCount: record.roomCount,
            adultCount: record.adultCount,
            childCount: record.childCount,
            bookingIdentity: record.bookingIdentity || null,
            bookingTerms: record.bookingTerms || null,
            publicReviewOffer: record.publicReviewOffer || null,
            lockedSellAmount: record.lockedSellAmount,
            lockedSellCurrency: record.lockedSellCurrency,
            expiresAt: new Date(record.expiresAt)
        };
    }

    async function claimBookingOffer(publicOfferId, attemptId, clientReference) {
        if (providerScope !== 'hotelbeds' && !testOnly) throw fail('offer_cache_provider_scope_mismatch', 503);
        if (!validPublicOfferId(publicOfferId)) throw fail('offer_cache_public_id_invalid', 404);
        if (typeof attemptId !== 'string' || !/^[a-f\d-]{36}$/i.test(attemptId)) {
            throw fail('offer_cache_booking_attempt_invalid', 400);
        }
        if (typeof clientReference !== 'string' || !/^RML[A-Z0-9]{10,17}$/.test(clientReference)) {
            throw fail('offer_cache_booking_reference_invalid', 400);
        }
        const claimedAt = new Date(now());
        if (Number.isNaN(claimedAt.getTime())) throw fail('offer_cache_clock_invalid', 503);
        await ensureDatabaseReady();
        const record = await Model.findOneAndUpdate(bookingFilter(publicOfferId, {
            expiresAt: { $gt: claimedAt },
            bookingState: 'available'
        }), {
            $set: {
                bookingState: 'processing',
                bookingAttemptId: attemptId,
                bookingClientReference: clientReference,
                bookingUpdatedAt: claimedAt
            },
            $unset: { bookingError: '' }
        }, { new: true }).select([
            '+opaqueToken', '+lockedNetPrice', '+currency', '+paymentType', '+rateType',
            '+roomCount', '+adultCount', '+childCount', '+bookingAttemptId', '+bookingClientReference',
            '+bookingIdentity'
        ].join(' ')).lean().exec();
        if (record) return record;

        const existing = await Model.findOne(bookingFilter(publicOfferId, {
            expiresAt: { $gt: claimedAt }
        }))
            .select('bookingState').lean().exec();
        if (!existing) return null;
        throw fail('offer_cache_booking_already_claimed', 409);
    }

    async function finishBookingOffer(publicOfferId, attemptId, {
        state,
        clientReference = null,
        bookingReference = null,
        bookingStatus = null,
        bookingError = null
    } = {}) {
        if (providerScope !== 'hotelbeds' && !testOnly) throw fail('offer_cache_provider_scope_mismatch', 503);
        if (!validPublicOfferId(publicOfferId)
            || typeof attemptId !== 'string' || !/^[a-f\d-]{36}$/i.test(attemptId)
            || !['available', 'confirmed', 'pending', 'failed', 'outcome_unknown'].includes(state)) {
            throw fail('offer_cache_booking_update_invalid', 503);
        }
        const updatedAt = new Date(now());
        if (Number.isNaN(updatedAt.getTime())) throw fail('offer_cache_clock_invalid', 503);
        await ensureDatabaseReady();
        const update = {
            $set: {
                bookingState: state,
                bookingUpdatedAt: updatedAt,
                ...(clientReference ? { bookingClientReference: clientReference } : {}),
                ...(bookingReference ? { bookingReference } : {}),
                ...(bookingStatus ? { bookingStatus } : {}),
                ...(bookingError ? { bookingError } : {})
            }
        };
        if (bookingError && !/^[a-z][a-z0-9_]{0,79}$/.test(bookingError)) {
            throw fail('offer_cache_booking_update_invalid', 503);
        }
        if (state === 'available') {
            update.$unset = {
                bookingAttemptId: '', bookingClientReference: ''
            };
        }
        const result = await Model.updateOne(bookingFilter(publicOfferId, {
            bookingState: 'processing',
            bookingAttemptId: attemptId
        }), update);
        if (!result || result.modifiedCount !== 1) throw fail('offer_cache_booking_state_conflict', 503);
        return true;
    }

    return {
        storeOffers, retrieveOffer, getBookingOffer, getCheckoutOffer, getRateReviewOffer,
        claimBookingOffer, finishBookingOffer
    };
}

const defaultService = createOfferCacheService();
const hotelbedsService = createOfferCacheService({
    Model: require('../models/HotelbedsOfferCache'),
    providerScope: 'hotelbeds'
});

const getBookingOffer = publicOfferId => defaultService.getBookingOffer(publicOfferId);
const getCheckoutOffer = publicOfferId => defaultService.getCheckoutOffer(publicOfferId);
const claimBookingOffer = (publicOfferId, attemptId, clientReference) =>
    defaultService.claimBookingOffer(publicOfferId, attemptId, clientReference);
const finishBookingOffer = (publicOfferId, attemptId, result) =>
    defaultService.finishBookingOffer(publicOfferId, attemptId, result);

const hotelbeds = Object.freeze({
    storeOffers: hotelbedsService.storeOffers,
    retrieveOffer: hotelbedsService.retrieveOffer,
    getBookingOffer: hotelbedsService.getBookingOffer,
    getCheckoutOffer: hotelbedsService.getCheckoutOffer,
    getRateReviewOffer: hotelbedsService.getRateReviewOffer,
    claimBookingOffer: hotelbedsService.claimBookingOffer,
    finishBookingOffer: hotelbedsService.finishBookingOffer
});

module.exports = {
    OFFER_TTL_MS,
    createOfferCacheService,
    hotelbeds,
    storeOffers: defaultService.storeOffers,
    retrieveOffer: defaultService.retrieveOffer,
    getBookingOffer,
    getCheckoutOffer,
    claimBookingOffer,
    finishBookingOffer
};