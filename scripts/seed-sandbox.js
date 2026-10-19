const { sandboxDatabaseConfigured } = require('../services/sandboxDatabase');

function assertSandboxSeedEnvironment(env) {
    if (!sandboxDatabaseConfigured(env) || env.ZIINA_TEST_MODE !== 'true'
        || env.PAYMENT_PRODUCTION_APPROVED === 'true' || env.PAYMENT_ETG_SANDBOX_ISOLATED !== 'true'
        || !/^https:\/\/api-sandbox\.ratehawk\.com(?:\/api\/b2b\/v3)?\/?$/.test(env.RATEHAWK_BASE_URL || '')
        || env.ETG_CERT_SANDBOX_TEST_DATA_CONFIRMED !== 'true'
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SANDBOX_TEST_USER_EMAIL || '')
        || env.SANDBOX_TEST_USER_EMAIL !== env.ETG_CERT_GUEST_EMAIL
        || !/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(env.SANDBOX_TEST_USER_PASSWORD_HASH || '')) {
        throw new Error('sandbox_seed_configuration_invalid');
    }
}

async function seedSandbox(env = process.env) {
    assertSandboxSeedEnvironment(env);
    const mongoose = require('mongoose');
    const Hotel = require('../models/Hotel');
    const client = require('../services/ratehawkClient');
    const { extractHotels, toHotelOperation } = require('../syncFilteredHotels');
    const ids = [10004834, 8819557, 10484558];
    try {
        await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 10000 });
        if (mongoose.connection.name !== env.PAYMENT_SANDBOX_DATABASE) throw new Error('sandbox_database_mismatch');
        const users = mongoose.connection.db.collection('users');
        await users.createIndex({ email: 1 }, { unique: true });
        await users.updateOne({ email: env.SANDBOX_TEST_USER_EMAIL }, { $setOnInsert: {
            name: 'Sandbox QA', email: env.SANDBOX_TEST_USER_EMAIL, password: env.SANDBOX_TEST_USER_PASSWORD_HASH,
            phone: env.ETG_CERT_GUEST_PHONE, points: 0, savedCards: [], createdAt: new Date()
        } }, { upsert: true, writeConcern: { w: 'majority', j: true, wtimeout: 10000 } });
        const response = await client.hotelContentByIds({ language: 'en', hids: ids });
        if (!response.ok) throw new Error('sandbox_content_unavailable');
        const hotels = extractHotels(response.data).filter(hotel => ids.includes(Number(hotel.hid)));
        const operations = hotels.map(toHotelOperation).filter(Boolean);
        if (!operations.length) throw new Error('sandbox_content_empty');
        await Hotel.bulkWrite(operations);
        return { userConfigured: true, hotels: operations.length, databaseIsolated: true };
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    const file = process.argv.find(value => value.startsWith('--env-file='));
    if (file) require('dotenv').config({ path: file.slice('--env-file='.length) });
    seedSandbox().then(result => console.log(JSON.stringify(result))).catch(() => {
        console.error('Sandbox fixture setup failed; inspect configuration and supplier access. No production database is permitted.');
        process.exitCode = 1;
    });
}

module.exports = { seedSandbox, assertSandboxSeedEnvironment };
