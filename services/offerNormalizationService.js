const DISPLAY_CURRENCIES = Object.freeze(['AED', 'EUR', 'SAR', 'USD']);
const BOARD_CODES = new Set(['AI', 'BB', 'FB', 'HB', 'RO', 'UAI']);

function objectOrEmpty(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function textOrNull(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function currencyCode(value) {
    const currency = textOrNull(value)?.toUpperCase();
    return currency && /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function decimalString(value) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value < 0) return null;
        value = String(value);
    }
    if (typeof value !== 'string') return null;
    const amount = value.trim();
    return /^\d+(?:\.\d+)?$/.test(amount) ? amount : null;
}

function nonNegativeInteger(value, allowZero = true) {
    if (value === null || value === undefined || typeof value === 'boolean'
        || typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) return null;
    return parsed;
}

function stayDate(value) {
    const source = textOrNull(value);
    if (!source || !/^\d{4}-\d{2}-\d{2}$/.test(source)) return null;
    const parsed = new Date(`${source}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === source
        ? source : null;
}

function providerIdentifier(value) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
    return null;
}

function timestamp(value) {
    const source = textOrNull(value);
    if (!source) return null;
    const match = source.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/i);
    const calendarDate = match ? `${match[1]}-${match[2]}-${match[3]}` : null;
    const parsedDate = calendarDate ? new Date(`${calendarDate}T00:00:00.000Z`) : null;
    const calendarValid = Boolean(parsedDate && !Number.isNaN(parsedDate.getTime())
        && parsedDate.toISOString().slice(0, 10) === calendarDate);
    const clockValid = Boolean(match && Number(match[4]) <= 23 && Number(match[5]) <= 59
        && Number(match[6]) <= 59 && (!match[9]
            || Number(match[9]) <= 23 && Number(match[10]) <= 59));
    const hasTimezone = Boolean(match && calendarValid && clockValid);
    const milliseconds = hasTimezone ? Date.parse(source) : NaN;
    return {
        source,
        utc: Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null,
        timezoneKnown: Number.isFinite(milliseconds)
    };
}

function normalizeBoard(codeValue, nameValue) {
    const supplierCode = textOrNull(codeValue)?.toUpperCase() || null;
    const supplierName = textOrNull(nameValue);
    const searchable = `${supplierCode || ''} ${supplierName || ''}`.toUpperCase();
    let normalizedCode = BOARD_CODES.has(supplierCode) ? supplierCode : null;
    if (!normalizedCode) {
        if (/\bULTRA\s+ALL\s+INCLUSIVE\b/.test(searchable)) normalizedCode = 'UAI';
        else if (/\bALL\s+INCLUSIVE\b/.test(searchable)) normalizedCode = 'AI';
        else if (/\bFULL\s+BOARD\b/.test(searchable)) normalizedCode = 'FB';
        else if (/\bHALF\s+BOARD\b/.test(searchable)) normalizedCode = 'HB';
        else if (/\b(BREAKFAST|BED\s+AND\s+BREAKFAST)\b/.test(searchable)) normalizedCode = 'BB';
        else if (/\bROOM\s+ONLY\b/.test(searchable)) normalizedCode = 'RO';
    }
    return { supplierCode, supplierName, normalizedCode: normalizedCode || 'UNKNOWN' };
}

function normalizeTaxItems(items, mapper) {
    return Array.isArray(items) ? items.map(mapper) : [];
}

function hotelbedsTaxes(rate) {
    if (!Object.hasOwn(rate, 'taxes') || rate.taxes == null) {
        return { status: 'not_provided', allIncluded: null, items: [] };
    }
    const taxes = objectOrEmpty(rate.taxes);
    const sourceItems = Array.isArray(taxes.taxes) ? taxes.taxes : [];
    return {
        status: 'provided',
        allIncluded: typeof taxes.allIncluded === 'boolean' ? taxes.allIncluded : null,
        items: normalizeTaxItems(sourceItems, item => ({
            included: typeof item?.included === 'boolean' ? item.included : null,
            amount: decimalString(item?.amount),
            currency: currencyCode(item?.currency),
            clientAmount: decimalString(item?.clientAmount),
            clientCurrency: currencyCode(item?.clientCurrency),
            type: textOrNull(item?.type),
            subType: textOrNull(item?.subType)
        }))
    };
}

function ratehawkTaxes(payment, rate) {
    const taxData = payment?.tax_data ?? rate?.tax_data;
    if (!taxData || typeof taxData !== 'object') {
        return { status: 'not_provided', allIncluded: null, items: [] };
    }
    const sourceItems = Array.isArray(taxData.taxes) ? taxData.taxes : [];
    return {
        status: 'provided',
        allIncluded: typeof taxData.all_included === 'boolean'
            ? taxData.all_included
            : sourceItems.length && sourceItems.every(item => typeof item?.included_by_supplier === 'boolean')
                ? sourceItems.every(item => item.included_by_supplier) : null,
        items: normalizeTaxItems(sourceItems, item => ({
            included: typeof item?.included_by_supplier === 'boolean' ? item.included_by_supplier : null,
            amount: decimalString(item?.amount),
            currency: currencyCode(item?.currency_code || item?.currency),
            clientAmount: decimalString(item?.amount_show),
            clientCurrency: currencyCode(item?.show_currency_code),
            type: textOrNull(item?.name || item?.type),
            subType: null
        }))
    };
}

function hotelbedsCancellation(rate, currency) {
    const source = Array.isArray(rate.cancellationPolicies) ? rate.cancellationPolicies : [];
    return {
        freeCancellationBefore: null,
        schedule: source.map(policy => ({
            startsAt: timestamp(policy?.from),
            endsAt: null,
            penalty: {
                amount: decimalString(policy?.amount),
                currency
            }
        }))
    };
}

function ratehawkCancellation(payment, rate, currency) {
    const cancellation = payment?.cancellation_penalties || rate?.cancellation_penalties;
    if (!cancellation || typeof cancellation !== 'object') {
        return { freeCancellationBefore: null, schedule: [] };
    }
    const policies = Array.isArray(cancellation.policies) ? cancellation.policies : [];
    return {
        // RateHawk sometimes returns local hotel wall-time without an offset.
        // Keep the source value; timestamp() deliberately leaves UTC unresolved.
        freeCancellationBefore: timestamp(cancellation.free_cancellation_before),
        schedule: policies.map(policy => ({
            startsAt: timestamp(policy?.start_at),
            endsAt: timestamp(policy?.end_at),
            penalty: {
                amount: decimalString(policy?.amount_charge),
                currency
            },
            displayAmount: decimalString(policy?.amount_show)
        }))
    };
}

function refundabilityFor(rate, cancellation) {
    const rateClass = String(rate?.rateClass || '').toUpperCase();
    const promotions = Array.isArray(rate?.promotions) ? rate.promotions : [];
    const explicitlyNonRefundable = rateClass === 'NRF'
        || promotions.some(promotion => /non[ -]refundable/i.test(
            `${promotion?.name || ''} ${promotion?.remark || ''}`
        ));
    if (explicitlyNonRefundable) return 'non_refundable';
    return cancellation.schedule.length ? 'conditional' : 'unknown';
}

function normalizeRate({
    provider,
    providerHotelId,
    hotel,
    room,
    rate,
    amount,
    currency,
    amountBasis,
    boardCode,
    boardName,
    paymentType,
    cancellation,
    taxes,
    promotions,
    stay
}) {
    const normalizedCancellation = cancellation(rate, currency);
    return {
        schemaVersion: 1,
        provider,
        providerHotelId: providerIdentifier(providerHotelId),
        hotel: {
            canonicalId: null,
            name: textOrNull(hotel.name),
            category: {
                code: textOrNull(hotel.categoryCode || hotel.category?.code),
                name: textOrNull(hotel.categoryName || hotel.category?.name)
            },
            destinationCode: textOrNull(hotel.destinationCode),
            destinationName: textOrNull(hotel.destinationName)
        },
        room: {
            providerCode: textOrNull(room.code || rate.room_code || rate.room_group_id),
            name: textOrNull(room.name || rate.room_name || rate.name)
        },
        stay: {
            checkIn: stayDate(stay?.checkIn),
            checkOut: stayDate(stay?.checkOut)
        },
        occupancy: {
            rooms: nonNegativeInteger(rate.rooms, false),
            adults: nonNegativeInteger(rate.adults),
            children: nonNegativeInteger(rate.children)
        },
        price: {
            supplierAmount: {
                amount: decimalString(amount),
                currency: currencyCode(currency),
                basis: amountBasis
            },
            customerDisplay: null
        },
        board: normalizeBoard(boardCode, boardName),
        availability: {
            rateType: textOrNull(rate.rateType || rate.book_status),
            rateClass: textOrNull(rate.rateClass),
            allotment: Number.isSafeInteger(Number(rate.allotment)) && Number(rate.allotment) >= 0
                ? Number(rate.allotment) : null,
            packaging: typeof rate.packaging === 'boolean' ? rate.packaging : null
        },
        payment: { type: textOrNull(paymentType ?? rate.paymentType ?? rate.payment_type) },
        cancellation: {
            refundability: refundabilityFor(rate, normalizedCancellation),
            freeCancellationBefore: normalizedCancellation.freeCancellationBefore,
            schedule: normalizedCancellation.schedule
        },
        taxes: taxes(rate),
        promotions: Array.isArray(promotions) ? promotions.map(promotion => ({
            code: textOrNull(promotion?.code),
            name: textOrNull(promotion?.name),
            remark: textOrNull(promotion?.remark)
        })) : [],
        // Internal offer identity is server-side data; callers must never expose
        // this field or serialize it into public search/listing responses.
        booking: {
            referenceVisibility: 'server_only',
            requiresOpaqueReference: Boolean(rate.rateKey || rate.book_hash || rate.match_hash),
            opaqueToken: textOrNull(rate.rateKey || rate.book_hash || rate.match_hash)
        }
    };
}

function normalizeHotelbedsHotel(hotel, { stay = {} } = {}) {
    if (!hotel || typeof hotel !== 'object' || Array.isArray(hotel)
        || !providerIdentifier(hotel.code)) return [];
    const providerHotelId = hotel.code;
    const currency = currencyCode(hotel.currency);
    const rooms = Array.isArray(hotel.rooms) ? hotel.rooms : [];
    return rooms.flatMap(room => (Array.isArray(room?.rates) ? room.rates : [])
        .filter(rate => rate && typeof rate === 'object' && !Array.isArray(rate))
        .map(rate => normalizeRate({
            provider: 'hotelbeds',
            providerHotelId,
            hotel,
            room,
            rate,
            amount: rate.net,
            currency,
            amountBasis: 'supplier_net',
            boardCode: rate.boardCode,
            boardName: rate.boardName,
            paymentType: rate.paymentType,
            cancellation: hotelbedsCancellation,
            taxes: hotelbedsTaxes,
            promotions: rate.promotions,
            stay
        })));
}

function ratehawkPayment(rate) {
    const paymentTypes = rate?.payment_options?.payment_types;
    if (!Array.isArray(paymentTypes)) return {};
    return paymentTypes.find(payment => payment?.type === 'deposit') || paymentTypes[0] || {};
}

function normalizeRateHawkHotel(hotel, { stay = {} } = {}) {
    if (!hotel || typeof hotel !== 'object' || Array.isArray(hotel)) return [];
    const providerHotelId = hotel.id ?? hotel.hid;
    if (!providerIdentifier(providerHotelId) || !Array.isArray(hotel.rates)) return [];
    return hotel.rates.filter(rate => rate && typeof rate === 'object' && !Array.isArray(rate)).map(rate => {
        const payment = ratehawkPayment(rate);
        const currency = currencyCode(payment.currency_code || rate.currency);
        const room = {
            code: rate.room_group_id || rate.room_code,
            name: rate.room_name || rate.name
        };
        const cancellationForRate = (sourceRate, sourceCurrency) => ratehawkCancellation(
            payment, sourceRate, sourceCurrency
        );
        return normalizeRate({
            provider: 'ratehawk',
            providerHotelId,
            hotel,
            room,
            rate,
            amount: payment.amount ?? rate.price,
            currency,
            amountBasis: payment.amount !== undefined && payment.amount !== null
                ? 'ratehawk_payment_amount' : 'ratehawk_price_fallback',
            boardCode: rate.meal?.code || rate.meal,
            boardName: rate.meal?.name || rate.meal,
            paymentType: payment.type,
            cancellation: cancellationForRate,
            taxes: sourceRate => ratehawkTaxes(payment, sourceRate),
            promotions: rate.promotions,
            stay
        });
    });
}

function assessCustomerDisplayEligibility(offer, {
    displayPolicyApproved = false,
    displayCurrency
} = {}) {
    const reasons = [];
    const supplierAmount = offer?.price?.supplierAmount || {};
    const amount = decimalString(supplierAmount.amount);
    const sourceCurrency = currencyCode(supplierAmount.currency);
    const requestedCurrency = currencyCode(displayCurrency || sourceCurrency);
    const customerDisplay = offer?.price?.customerDisplay || {};
    const customerAmount = decimalString(customerDisplay.amount);
    const customerCurrency = currencyCode(customerDisplay.currency);

    if (displayPolicyApproved !== true) reasons.push('display_policy_not_approved');
    if (!amount || Number(amount) <= 0) reasons.push('supplier_net_invalid');
    if (!sourceCurrency) reasons.push('supplier_currency_missing_or_invalid');
    if (requestedCurrency && !DISPLAY_CURRENCIES.includes(requestedCurrency)) {
        reasons.push('display_currency_unsupported');
    }
    if (!requestedCurrency) reasons.push('display_currency_missing');
    if (!customerAmount || Number(customerAmount) <= 0) reasons.push('display_price_not_computed');
    if (!customerCurrency) reasons.push('display_price_currency_missing');
    if (requestedCurrency && customerCurrency && requestedCurrency !== customerCurrency) {
        reasons.push('display_price_currency_mismatch');
    }
    if (sourceCurrency && requestedCurrency && sourceCurrency !== requestedCurrency
        && customerCurrency !== requestedCurrency) reasons.push('display_conversion_not_provided');

    return {
        eligible: reasons.length === 0,
        reasons,
        displayCurrency: requestedCurrency
    };
}

function toCustomerDisplayOffer(offer, options = {}) {
    const eligibility = assessCustomerDisplayEligibility(offer, options);
    if (!eligibility.eligible) return { eligible: false, reasons: eligibility.reasons };

    const display = offer.price.customerDisplay;
    return {
        eligible: true,
        offer: {
            provider: offer.provider,
            hotel: {
                canonicalId: offer.hotel?.canonicalId ?? null,
                name: offer.hotel?.name ?? null,
                category: offer.hotel?.category ?? null
            },
            room: {
                name: offer.room?.name ?? null
            },
            stay: offer.stay,
            occupancy: offer.occupancy,
            price: {
                amount: decimalString(display.amount),
                currency: currencyCode(display.currency)
            },
            board: offer.board,
            cancellation: {
                refundability: offer.cancellation?.refundability ?? 'unknown',
                freeCancellationBefore: offer.cancellation?.freeCancellationBefore ?? null
            }
        }
    };
}

module.exports = {
    DISPLAY_CURRENCIES,
    currencyCode,
    decimalString,
    stayDate,
    providerIdentifier,
    timestamp,
    normalizeBoard,
    normalizeHotelbedsHotel,
    normalizeRateHawkHotel,
    assessCustomerDisplayEligibility,
    toCustomerDisplayOffer
};