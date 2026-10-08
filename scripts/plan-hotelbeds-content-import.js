const { contentImportPlan, contentImportPlanSummary } = require('../services/hotelbedsContentImportService');
const { contentPlanningReadiness } = require('../services/deploymentReadiness');

function parseRequest(raw) {
    if (typeof raw !== 'string' || !raw.trim()) {
        throw Object.assign(new Error('content_plan_request_required'), { code: 'content_plan_request_required' });
    }
    let request;
    try { request = JSON.parse(raw); }
    catch { throw Object.assign(new Error('content_plan_request_invalid'), { code: 'content_plan_request_invalid' }); }
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw Object.assign(new Error('content_plan_request_invalid'), { code: 'content_plan_request_invalid' });
    }
    return request;
}

function parseArguments(args) {
    if (args.length === 1 && args[0].trimStart().startsWith('{')) return parseRequest(args[0]);
    const request = { hotelCodes: [] };
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (!argument.startsWith('--')) {
            throw Object.assign(new Error('content_plan_argument_invalid'), { code: 'content_plan_argument_invalid' });
        }
        const separator = argument.indexOf('=');
        const key = argument.slice(2, separator < 0 ? undefined : separator);
        let value = separator < 0 ? args[++index] : argument.slice(separator + 1);
        if (typeof value !== 'string' || !value) {
            throw Object.assign(new Error('content_plan_argument_invalid'), { code: 'content_plan_argument_invalid' });
        }
        if (key === 'hotel-code') request.hotelCodes.push(value);
        else if (key === 'language') request.language = value;
        else if (key === 'from' || key === 'page-size' || key === 'page-limit') {
            const normalizedKey = key.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
            request[normalizedKey] = Number(value);
        } else {
            throw Object.assign(new Error('content_plan_argument_invalid'), { code: 'content_plan_argument_invalid' });
        }
    }
    if (!request.hotelCodes.length || !request.language) {
        throw Object.assign(new Error('content_plan_request_required'), { code: 'content_plan_request_required' });
    }
    return request;
}

function createPlanOutput(request, env = process.env) {
    const readiness = contentPlanningReadiness(env);
    if (!readiness.ready) {
        throw Object.assign(new Error('hotelbeds_content_plan_gates_unavailable'), {
            code: 'hotelbeds_content_plan_gates_unavailable'
        });
    }
    const plan = contentImportPlan(request, env);
    return contentImportPlanSummary(plan);
}

function main(argv = process.argv.slice(2), env = process.env, stdout = process.stdout, stderr = process.stderr) {
    try {
        const request = parseArguments(argv);
        stdout.write(`${JSON.stringify(createPlanOutput(request, env), null, 2)}\n`);
        return 0;
    } catch (error) {
        const code = error?.code || 'hotelbeds_content_plan_unavailable';
        stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
        return 1;
    }
}

if (require.main === module) process.exitCode = main();

module.exports = { parseRequest, parseArguments, createPlanOutput, main };