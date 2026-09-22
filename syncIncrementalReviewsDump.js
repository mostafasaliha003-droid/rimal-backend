// Synchronize the ETG incremental hotel reviews dump without overwriting static data.

require('dotenv').config();

const client = require('./services/ratehawkClient');
const logger = require('./services/loggerService');
const { syncDump, toReviewsOperation } = require('./services/hotelDumpSyncService');

async function syncIncrementalReviewsDump() {
    return syncDump({
        name: 'incremental hotel reviews',
        getUrl: () => client.getIncrementalReviewsDumpUrl(),
        operationFactory: toReviewsOperation,
        compression: 'gzip'
    });
}

if (require.main === module) {
    syncIncrementalReviewsDump().catch(error => {
        logger.error('ETG incremental hotel reviews dump synchronization failed', { error: error.message });
        process.exitCode = 1;
    });
}

module.exports = { syncIncrementalReviewsDump };
