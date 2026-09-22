require('dotenv').config();

const baseUrl = String(process.env.TEST_BASE_URL || 'http://localhost:10000').replace(/\/+$/, '');
const apiKey = process.env.REMAL_SECURE_KEY || '';
const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey
};

async function requestJson(label, url, options = {}) {
    console.log(`\n=== ${label} ===`);
    console.log(`${options.method || 'GET'} ${url}`);
    if (options.body) console.log('Request body:', options.body);

    try {
        const response = await fetch(url, options);
        const text = await response.text();
        let json;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = null;
        }

        console.log('HTTP status:', response.status, response.statusText);
        console.log('JSON response:', JSON.stringify(json, null, 2));
        if (json === null) console.log('Raw response:', text);

        if (!response.ok) {
            throw new Error(`${label} failed with HTTP ${response.status}: ${text}`);
        }
        return json;
    } catch (error) {
        console.error(`${label} error trace:`);
        console.error(error.stack || error);
        throw error;
    }
}

function extractHotel(response) {
    return response?.hotel
        || response?.hotels?.[0]
        || response?.data?.hotels?.[0]
        || null;
}

function extractRates(response) {
    const hotel = extractHotel(response);
    return response?.rates || hotel?.rates || response?.hotels?.[0]?.rates || [];
}

function extractPrice(rate) {
    return rate?.payment_options?.payment_types?.[0]?.amount
        ?? rate?.price
        ?? null;
}

function extractCurrency(rate) {
    return rate?.payment_options?.payment_types?.[0]?.currency_code
        || rate?.currency
        || 'USD';
}

function extractHash(rate) {
    return rate?.book_hash || rate?.room_hash || rate?.match_hash || null;
}

async function run() {
    if (!apiKey) {
        throw new Error('REMAL_SECURE_KEY is missing from the environment.');
    }

    const hotelId = '10172181';
    const checkin = process.env.TEST_CHECKIN || '2026-10-10';
    const checkout = process.env.TEST_CHECKOUT || '2026-10-12';
    const guests = [{ adults: 2, children: [] }];

    const staticResponse = await requestJson(
        '1. Static hotel lookup',
        `${baseUrl}/api/v1/hotels/${hotelId}`,
        { headers: { 'x-api-key': apiKey } }
    );

    const ratesPayload = {
        hid: Number(hotelId),
        checkin,
        checkout,
        guests,
        language: 'en',
        currency: 'USD'
    };
    const ratesResponse = await requestJson(
        '2. Live hotelpage rates',
        `${baseUrl}/api/search/hotelpage`,
        { method: 'POST', headers, body: JSON.stringify(ratesPayload) }
    );

    const rates = extractRates(ratesResponse);
    if (!rates.length) {
        throw new Error('No live room rates were returned; cannot test payment intent.');
    }

    const rate = rates[0];
    const price = extractPrice(rate);
    const roomHash = extractHash(rate);
    const currency = extractCurrency(rate);
    console.log('\nSelected exact room values:');
    console.log(JSON.stringify({ price, currency, roomHash }, null, 2));

    if (price === null || roomHash === null) {
        throw new Error(`The first rate is missing price or room hash: ${JSON.stringify(rate, null, 2)}`);
    }

    const hotel = extractHotel(staticResponse) || extractHotel(ratesResponse) || {};
    const paymentPayload = {
        total: Number(price),
        currency,
        hid: Number(hotel.hid || hotelId),
        book_hash: roomHash,
        room_hash: roomHash,
        hotelName: hotel.name || 'Checkout flow test hotel',
        roomName: rate.room_name || rate.name || 'Test room',
        checkin,
        checkout,
        guest: {
            firstName: 'Checkout',
            lastName: 'Test',
            email: 'checkout-test@example.com',
            phone: '+971500000000',
            specialRequests: 'Automated checkout flow test'
        }
    };

    await requestJson(
        '3. Ziina payment intent',
        `${baseUrl}/api/payment/ziina/intent`,
        { method: 'POST', headers, body: JSON.stringify(paymentPayload) }
    );

    console.log('\nCheckout flow test completed successfully.');
}

run().catch(() => {
    console.error('\nCheckout flow test failed. See the error trace above.');
    process.exitCode = 1;
});
