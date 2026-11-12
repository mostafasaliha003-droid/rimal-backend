// Sandbox-only offline Content/region synchronization with a durable cursor and
// transaction-fenced writer lease. Without --apply this prints its bounded plan.
async function main(args = process.argv.slice(2)) {
    if (args.includes('--help')) {
        console.log('Usage: node scripts/sync-ratehawk-static.js <content|regions> [--apply]');
        console.log('Requires the isolated Sandbox database and Sandbox supplier account. Content requires explicit RATEHAWK_FILTERS_JSON with country IDs verified against filter_values.');
        console.log('Regions require RATEHAWK_REGION_DUMP_HOSTS containing the verified supplier download hostname(s); redirects and private addresses are rejected.');
        return;
    }
    if (args.length < 1 || args.length > 2 || args.some((arg, index) => index > 0 && arg !== '--apply')) {
        throw Object.assign(new Error('static_sync_arguments_invalid'), { code: 'static_sync_arguments_invalid' });
    }
    require('dotenv').config();
    const { staticSyncPlan, createStaticSyncCoordinator, createMongoStaticSyncStore } = require('../services/ratehawkStaticSyncCoordinator');
    const plan = staticSyncPlan(args[0]);
    console.log(JSON.stringify({ job: plan.kind, environment: 'sandbox', language: plan.language,
        filters: plan.filters, maxHotels: plan.maxHotels, scope: plan.scopeKey,
        ...(plan.regionDumpHosts ? { regionDumpHosts: plan.regionDumpHosts } : {}),
        action: args.includes('--apply') ? 'apply' : 'plan' }));
    if (!args.includes('--apply')) return;
    const mongoose = require('mongoose');
    const connection = await mongoose.createConnection(process.env.MONGO_URI, {
        maxPoolSize: 4, serverSelectionTimeoutMS: 10000
    }).asPromise();
    try {
        const store = createMongoStaticSyncStore(connection);
        const coordinator = createStaticSyncCoordinator({ store });
        const jobs = require('../services/ratehawkStaticSyncJobs');
        let result;
        if (plan.kind === 'content') {
            const Original = require('../models/Hotel');
            const HotelModel = connection.model('Hotel', Original.schema, Original.collection.name);
            await HotelModel.init();
            result = await coordinator.run(plan, context => jobs.syncContentJob({ plan, context, HotelModel }));
        } else {
            const Original = require('../models/Region');
            const RegionModel = connection.model('Region', Original.schema, Original.collection.name);
            await RegionModel.init();
            result = await coordinator.run(plan, context => jobs.syncRegionsJob({ plan, context, RegionModel }));
        }
        console.log(JSON.stringify({ success: true, job: plan.kind, ...result }));
        return result;
    } finally { await connection.close(); }
}

if (require.main === module) {
    main().catch(error => {
        const code = error.code || error.ratehawkError;
        console.error('RateHawk static sync failed:', typeof code === 'string' && /^[a-z0-9_]+$/i.test(code) ? code : 'static_sync_failed');
        process.exitCode = 1;
    });
}

module.exports = { main };
