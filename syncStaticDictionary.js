// Synchronize the ETG hotel static dictionaries into a single MongoDB document.

require('dotenv').config();

const mongoose = require('mongoose');
const client = require('./services/ratehawkClient');
const logger = require('./services/loggerService');
const StaticDictionary = require('./models/StaticDictionary');

async function syncStaticDictionary() {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is missing in environment variables');
    await mongoose.connect(process.env.MONGO_URI);
    try {
        logger.info('Requesting ETG hotel static dictionary');
        const data = await client.getHotelStaticData();
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('ETG hotel static response did not contain a dictionary object');
        }

        await StaticDictionary.deleteMany({});
        await StaticDictionary.create(data);
        logger.info('ETG hotel static dictionary synchronized', {
            keys: Object.keys(data)
        });
        return data;
    } finally {
        await mongoose.connection.close();
    }
}

if (require.main === module) {
    syncStaticDictionary().catch(error => {
        logger.error('ETG hotel static dictionary synchronization failed', { error: error.message });
        process.exitCode = 1;
    });
}

module.exports = { syncStaticDictionary };
