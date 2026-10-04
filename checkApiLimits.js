// Display current ETG / RateHawk API endpoint limits.

require('dotenv').config();

const client = require('./services/ratehawkClient');
const logger = require('./services/loggerService');

function extractOverviewRows(response) {
    const data = response && response.data !== undefined ? response.data : response;
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.endpoints)) return data.endpoints;
    if (data && Array.isArray(data.overview)) return data.overview;
    return [];
}

function mapOverviewRows(response) {
    return extractOverviewRows(response).map(item => ({
        Endpoint: item.endpoint ?? item.path ?? item.url ?? '',
        Active: item.is_active ?? item.active ?? false,
        Limited: item.is_limited ?? item.limited ?? false,
        'Max Requests': item.requests_number ?? item.max_requests ?? item.maxRequests ?? null,
        'Time Window (s)': item.seconds_number ?? item.time_window_seconds ?? item.timeWindowSeconds ?? null
    }));
}

async function checkApiLimits() {
    const response = await client.getApiOverview();
    if (!response.ok) {
        throw new Error(response.error || `RateHawk overview failed with HTTP ${response.httpStatus}`);
    }
    const rows = mapOverviewRows(response);
    console.table(rows);
    return rows;
}

if (require.main === module) {
    checkApiLimits().catch(error => {
        logger.error('RateHawk API overview check failed', { error: error.message });
        process.exitCode = 1;
    });
}

module.exports = {
    extractOverviewRows,
    mapOverviewRows,
    checkApiLimits
};
