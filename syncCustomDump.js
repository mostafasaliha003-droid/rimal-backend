// Synchronize an ETG custom hotel dump, such as the ski inventory.

require('dotenv').config();

const client = require('./services/ratehawkClient');
const logger = require('./services/loggerService');
const { syncDump, toStaticOperation } = require('./services/hotelDumpSyncService');

function getDumpType() {
    const equalsArgument = process.argv.find(argument => argument.startsWith('--type='));
    const flagIndex = process.argv.indexOf('--type');
    const type = equalsArgument
        ? equalsArgument.slice('--type='.length)
        : (flagIndex >= 0 ? process.argv[flagIndex + 1] : '');
    if (!type || type.startsWith('--')) throw new Error('Custom dump type is required: use --type ski');
    return type;
}

async function syncCustomDump() {
    const type = getDumpType();
    return syncDump({
        name: `custom ${type}`,
        getUrl: () => client.getCustomDumpUrl(type),
        operationFactory: toStaticOperation,
        compression: 'zstd'
    });
}

if (require.main === module) {
    syncCustomDump().catch(error => {
        logger.error('ETG custom hotel dump synchronization failed', { error: error.message });
        process.exitCode = 1;
    });
}

module.exports = { getDumpType, syncCustomDump };
