const { toHotelOperation } = require('../syncFilteredHotels');
const { toRegionOperation } = require('../syncRegionDump');
const { syncDump } = require('./hotelDumpSyncService');

function fail(code) { return Object.assign(new Error(code), { code }); }
function numericId(value) {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^(?:0|[1-9]\d{0,9})$/.test(value))) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 && number <= 9999999999 ? number : null;
}

function validateSelectedFilters(filters, available) {
    for (const key of ['country', 'kind', 'star_rating', 'serp_filter']) {
        if (filters[key] === undefined) continue;
        if (!Array.isArray(available?.[key])) throw fail('static_sync_filter_values_unavailable');
        const choices = new Set(available[key].map(item => String(item && typeof item === 'object' ? item.value : item)));
        if (filters[key].some(value => !choices.has(String(value)))) throw fail('static_sync_filter_not_available');
    }
}

async function syncContentJob({ plan, context, HotelModel, client = require('./ratehawkClient'),
    service = require('./ratehawkService'), pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
    client.normalizeHotelIdFilters(plan.filters);
    context.assertActive();
    const values = await service.getFilterValues({ forceRefresh: true });
    validateSelectedFilters(plan.filters, values.filters);
    context.assertActive();
    const returned = await client.fetchHotelIdsByFilter({ ...plan.filters,
        ...(context.updatedSince ? { updated_since: context.updatedSince } : {}) });
    if (!Array.isArray(returned)) throw fail('static_sync_hotel_ids_invalid');
    const converted = returned.map(numericId);
    if (converted.some(value => value === null)) throw fail('static_sync_hotel_ids_invalid');
    const ids = [...new Set(converted)];
    if (ids.length > plan.maxHotels) throw fail('static_sync_hotel_limit_exceeded');
    const stats = { ids: ids.length, chunks: 0, content: 0, upserted: 0, modified: 0 };
    for (let offset = 0; offset < ids.length; offset += 100) {
        context.assertActive();
        const hids = ids.slice(offset, offset + 100);
        const response = await client.hotelContentByIds({ language: plan.language, hids });
        if (!response.ok || !Array.isArray(response.data)) throw fail('static_sync_content_unavailable');
        const content = response.data;
        const requested = new Set(hids);
        const found = new Set();
        for (const hotel of content) {
            if (!Number.isSafeInteger(hotel?.hid) || !requested.has(hotel.hid) || found.has(hotel.hid)) {
                throw fail('static_sync_content_identity_mismatch');
            }
            found.add(hotel.hid);
        }
        if (found.size !== requested.size) {
            // Do not silently advance the cursor over missing or mismatched
            // records. A later retry replays the same inclusive update window.
            throw fail('static_sync_content_identity_mismatch');
        }
        const operations = content.map(toHotelOperation);
        if (operations.some(operation => !operation)) throw fail('static_sync_content_invalid');
        const result = await context.writeBatch(HotelModel, operations);
        stats.upserted += result.upsertedCount || 0;
        stats.modified += result.modifiedCount || 0;
        stats.content += content.length;
        stats.chunks += 1;
        if (offset + hids.length < ids.length) await pause(1500);
    }
    return stats;
}

async function syncRegionsJob({ plan, context, RegionModel, client = require('./ratehawkClient'), dump = syncDump }) {
    context.assertActive();
    const stats = await dump({
        name: `region-${plan.scopeKey.slice(0, 12)}-${context.runId}`,
        getUrl: async () => {
            context.assertActive();
            const url = await client.getRegionDumpUrl();
            require('./ratehawkDumpDownloadPolicy').assertPublicDumpUrl(url, plan.regionDumpHosts);
            return url;
        },
        operationFactory: region => {
            const id = numericId(region?.id);
            if (id === null) throw fail('static_sync_region_id_invalid');
            return toRegionOperation({ ...region, id });
        },
        compression: 'zstd',
        manageConnection: false,
        downloadPolicy: { allowedHosts: plan.regionDumpHosts },
        model: { bulkWrite: operations => context.writeBatch(RegionModel, operations) }
    });
    context.assertActive();
    if (stats.read < 1 || stats.skipped > 0) throw fail('static_sync_regions_incomplete');
    return stats;
}

module.exports = { syncContentJob, syncRegionsJob, validateSelectedFilters, numericId };
