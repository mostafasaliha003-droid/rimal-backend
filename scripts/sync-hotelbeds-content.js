const { contentImportPlan } = require('../services/hotelbedsContentImportService');

// Operator-driven Content API sync. Plan mode never opens a supplier or DB
// connection; apply mode is TEST-only and always closes its isolated DB handle.
function argumentError(code) {
    return Object.assign(new Error(code), { code, httpStatus: 400 });
}

function parseArgs(argv) {
    const args = { apply: false, help: false, hotels: null, from: null, pageSize: null, pageLimit: null,
        lastUpdateTime: null };
    for (const raw of argv) {
        if (raw === '--help' || raw === '-h') {
            args.help = true;
            continue;
        }
        if (raw === '--apply') {
            args.apply = true;
            continue;
        }
        const match = /^--(hotels|from|page-size|page-limit|last-update-time)=(.*)$/.exec(String(raw));
        if (!match) throw argumentError('hotelbeds_content_sync_argument_invalid');
        const value = String(match[2]).trim();
        if (match[1] === 'hotels') {
            const codes = value.split(',').map(part => Number(part.trim()));
            if (!codes.length || codes.some(code => !Number.isSafeInteger(code) || code < 1)) {
                throw argumentError('hotelbeds_content_sync_argument_invalid');
            }
            args.hotels = codes;
        } else if (match[1] === 'last-update-time') {
            args.lastUpdateTime = value;
        } else {
            const number = Number(value);
            if (!Number.isSafeInteger(number) || number < 1) {
                throw argumentError('hotelbeds_content_sync_argument_invalid');
            }
            if (match[1] === 'from') args.from = number;
            else if (match[1] === 'page-size') args.pageSize = number;
            else args.pageLimit = number;
        }
    }
    if (!args.help && !args.hotels) throw argumentError('hotelbeds_content_sync_hotels_required');
    return args;
}

async function run(argv, {
    env = process.env,
    createService,
    createClient,
    closeResources,
    output = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
} = {}) {
    let exitCode = 1;
    let shouldCloseResources = false;
    try {
        const args = parseArgs(argv);
        if (args.help) {
            output({
                ok: true,
                mode: 'help',
                usage: 'npm run sync:hotelbeds-content -- --hotels=<approved-codes> [--last-update-time=YYYY-MM-DD] [--apply]'
            });
            exitCode = 0;
        } else {
            shouldCloseResources = args.apply;
            const options = {
                hotelCodes: args.hotels,
                language: String(env.HOTELBEDS_PILOT_LANGUAGE || '').trim(),
                ...(args.from === null ? {} : { from: args.from }),
                ...(args.pageSize === null ? {} : { pageSize: args.pageSize }),
                ...(args.pageLimit === null ? {} : { pageLimit: args.pageLimit }),
                ...(args.lastUpdateTime === null ? {} : { lastUpdateTime: args.lastUpdateTime })
            };
            if (options.from !== undefined && options.from !== 1) {
                throw Object.assign(new Error('hotelbeds_content_sync_partial_bootstrap_forbidden'), {
                    code: 'hotelbeds_content_sync_partial_bootstrap_forbidden', httpStatus: 400
                });
            }
            if (!args.apply) {
                output({ ok: true, mode: 'plan', plan: contentImportPlan(options, env) });
                exitCode = 0;
            } else {
                if (String(env.NODE_ENV || '').trim().toLowerCase() === 'production') {
                    throw Object.assign(new Error('hotelbeds_content_sync_production_forbidden'), {
                        code: 'hotelbeds_content_sync_production_forbidden', httpStatus: 403
                    });
                }
                shouldCloseResources = true;
                const service = typeof createService === 'function'
                    ? createService() : require('../services/hotelbedsContentSyncService')
                        .createHotelbedsContentSyncService({ env });
                const client = typeof createClient === 'function'
                    ? createClient() : require('../services/hotelbedsContentClient')
                        .createHotelbedsContentClient({ env });
                const fetch = method => async requestOptions => {
                    if (typeof client[method] !== 'function') {
                        throw Object.assign(new Error('hotelbeds_content_fetch_failed'), {
                            code: 'hotelbeds_content_fetch_failed', httpStatus: 502
                        });
                    }
                    const response = await client[method](requestOptions);
                    if (!response || response.ok !== true) {
                        throw Object.assign(new Error('hotelbeds_content_fetch_failed'), {
                            code: 'hotelbeds_content_fetch_failed', httpStatus: 502
                        });
                    }
                    return response.data;
                };
                if (typeof service.syncContent !== 'function') {
                    throw Object.assign(new Error('hotelbeds_content_sync_service_unavailable'), {
                        code: 'hotelbeds_content_sync_service_unavailable', httpStatus: 503
                    });
                }
                const result = await service.syncContent(options, {
                    fetchPage: fetch('getHotelsPage'),
                    fetchCategories: fetch('getCategoriesPage')
                });
                output({
                    ok: true,
                    mode: 'apply',
                    result: {
                        importedCount: result.importedCount,
                        pageCount: result.pageCount,
                        categoryRequestCount: result.categoryRequestCount,
                        supplierRequests: result.supplierRequests,
                        source: result.source,
                        ...(result.bootstrap !== undefined ? { bootstrap: result.bootstrap } : {}),
                        ...(result.lastUpdateTime !== undefined ? { lastUpdateTime: result.lastUpdateTime } : {})
                    }
                });
                exitCode = 0;
            }
        }
    } catch (error) {
        output({
            ok: false,
            error: typeof error?.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(error.code)
                ? error.code : 'hotelbeds_content_sync_failed',
            httpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : 500
        });
    } finally {
        if (shouldCloseResources && typeof closeResources === 'function') {
            try {
                await closeResources();
            } catch {
                if (exitCode === 0) {
                    output({ ok: false, error: 'hotelbeds_content_sync_cleanup_failed', httpStatus: 500 });
                    exitCode = 1;
                }
            }
        }
    }
    return exitCode;
}

if (require.main === module) {
    require('dotenv').config();
    run(process.argv.slice(2), {
        closeResources: async () => require('../services/hotelbedsMockDatabase').close()
    }).then(code => { process.exitCode = code; });
}

module.exports = { parseArgs, run };