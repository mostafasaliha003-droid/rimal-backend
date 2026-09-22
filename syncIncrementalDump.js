// Synchronize the ETG incremental hotel static-content dump.

require('dotenv').config();

const client = require('./services/ratehawkClient');
const logger = require('./services/loggerService');
const { syncDump, toStaticOperation } = require('./services/hotelDumpSyncService');

async function syncIncrementalDump() {
    return syncDump({
        name: 'incremental hotel',
        getUrl: () => client.getIncrementalDumpUrl(),
        operationFactory: toStaticOperation,
        compression: 'zstd'
    });
}

if (require.main === module) {
    syncIncrementalDump().catch(error => {
        logger.error('ETG incremental hotel dump synchronization failed', { error: error.message });
        process.exitCode = 1;
    });
}

module.exports = { syncIncrementalDump };
