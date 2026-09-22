// Synchronize the ETG regions dump into MongoDB.

require('dotenv').config();

const client = require('./services/ratehawkClient');
const logger = require('./services/loggerService');
const Region = require('./models/Region');
const { syncDump } = require('./services/hotelDumpSyncService');

function toRegionOperation(region) {
    if (!region || typeof region !== 'object') return null;
    const id = Number(region.id);
    if (!Number.isInteger(id)) return null;
    const center = region.center && typeof region.center === 'object' ? region.center : {};
    return {
        updateOne: {
            filter: { id },
            update: {
                $set: {
                    id,
                    type: region.type || '',
                    name: region.name || {},
                    country_code: region.country_code || '',
                    iata: region.iata || '',
                    center: {
                        latitude: Number(center.latitude) || 0,
                        longitude: Number(center.longitude) || 0
                    },
                    hids: Array.isArray(region.hids)
                        ? region.hids.map(Number).filter(Number.isInteger)
                        : [],
                    hotels: Array.isArray(region.hotels)
                        ? region.hotels.map(String)
                        : []
                }
            },
            upsert: true
        }
    };
}

async function syncRegionDump() {
    return syncDump({
        name: 'region',
        getUrl: () => client.getRegionDumpUrl(),
        operationFactory: toRegionOperation,
        compression: 'zstd',
        model: Region
    });
}

if (require.main === module) {
    syncRegionDump().catch(error => {
        logger.error('ETG region dump synchronization failed', { error: error.message });
        process.exitCode = 1;
    });
}

module.exports = { toRegionOperation, syncRegionDump };
