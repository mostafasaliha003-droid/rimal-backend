// Synchronize the ETG hotel point-of-interest dump into MongoDB.

require('dotenv').config();

const client = require('./services/ratehawkClient');
const logger = require('./services/loggerService');
const Poi = require('./models/Poi');
const { syncDump } = require('./services/hotelDumpSyncService');

function toPoiOperation(record) {
    if (!record || typeof record !== 'object') return null;
    const hid = Number(record.hid);
    const id = record.id;
    if (!Number.isInteger(hid) || id === undefined || id === null || id === '') return null;
    return {
        updateOne: {
            filter: { hid },
            update: {
                $set: {
                    id: String(id),
                    hid,
                    pois: Array.isArray(record.pois) ? record.pois : []
                }
            },
            upsert: true
        }
    };
}

async function syncPoiDump() {
    return syncDump({
        name: 'hotel POI',
        getUrl: () => client.getPoiDumpUrl(),
        operationFactory: toPoiOperation,
        compression: 'zstd',
        model: Poi
    });
}

if (require.main === module) {
    syncPoiDump().catch(error => {
        logger.error('ETG hotel POI dump synchronization failed', { error: error.message });
        process.exitCode = 1;
    });
}

module.exports = { toPoiOperation, syncPoiDump };
