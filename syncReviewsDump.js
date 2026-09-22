// Synchronize the ETG hotel reviews dump without overwriting static content.

require('dotenv').config();

const client = require('./services/ratehawkClient');
const logger = require('./services/loggerService');
const { syncDump, toReviewsOperation } = require('./services/hotelDumpSyncService');

async function syncReviewsDump() {
    return syncDump({
        name: 'hotel reviews',
        getUrl: () => client.getReviewsDumpUrl(),
        operationFactory: toReviewsOperation,
        compression: 'gzip'
    });
}

if (require.main === module) {
    syncReviewsDump().catch(error => {
        logger.error('ETG hotel reviews dump synchronization failed', { error: error.message });
        process.exitCode = 1;
    });
}

module.exports = { syncReviewsDump };
