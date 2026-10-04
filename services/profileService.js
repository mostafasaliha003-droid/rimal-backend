const client = require('./ratehawkClient');

const PROFILE_TYPES = new Set([
    'csbt_admin', 'employee', 'finance', 'manager', 'master', 'self_booker',
    'sub_agent_supervisor', 'supervisor', 'travel_manager'
]);
const PROFILE_STATUSES = new Set(['active', 'awaiting_confirmation', 'deleted', 'disabled']);

function profileError(code, httpStatus = 400) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function supplierFailure(response) {
    if (response?.credentialsMissing) throw profileError('supplier_credentials_missing', 503);
    if (response?.httpStatus === 429) {
        const seconds = Number(response.rateLimit?.secondsNumber);
        throw Object.assign(profileError('rate_limit', 429), {
            retry_after_ms: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60000
        });
    }
    if ([401, 403].includes(response?.httpStatus) || [
        'unauthorized', 'incorrect_credentials', 'no_auth_header', 'invalid_auth_header',
        'not_allowed_host', 'api_access_disabled'
    ].includes(response?.error)) throw profileError('supplier_unauthorized', 502);
    if (response?.error === 'users_profile_not_found') throw profileError('users_profile_not_found', 404);
    if (['user_already_exists', 'profile_is_already_disabled', 'profile_is_already_restored'].includes(response?.error)) {
        throw profileError(response.error, 409);
    }
    if (response?.httpStatus === 404 || response?.error === 'endpoint_not_active') {
        throw profileError('supplier_endpoint_unavailable', 502);
    }
    if (response?.httpStatus === 400 || response?.error === 'invalid_params') {
        throw profileError('supplier_request_rejected', 502);
    }
    if (response?.connectionFailed) throw profileError('supplier_connection_failed', 502);
    if (response?.error === 'unknown') throw profileError('supplier_unknown', 502);
    throw profileError('profile_unavailable', 502);
}

async function supplierResult(operation) {
    let response;
    try {
        response = await operation();
    } catch (error) {
        response = {
            error: error?.ratehawkError,
            httpStatus: error?.httpStatus || error?.response?.status,
            credentialsMissing: error?.code === 'ratehawk_credentials_missing',
            connectionFailed: ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(error?.code)
        };
    }
    if (response?.ok !== true || response.status !== 'ok' || response.error != null
        || !Number.isInteger(response.httpStatus) || response.httpStatus < 200 || response.httpStatus >= 300) {
        supplierFailure(response);
    }
    return response.data;
}

function profile(value) {
    return object(value) && typeof value.email === 'string' && value.email.trim()
        && typeof value.first_name === 'string' && value.first_name.trim()
        && typeof value.last_name === 'string' && value.last_name.trim()
        && (value.middle_name === null || typeof value.middle_name === 'string')
        && (value.phone === null || typeof value.phone === 'string')
        && PROFILE_STATUSES.has(value.status) && PROFILE_TYPES.has(value.type);
}

async function retrieveProfiles() {
    const data = await supplierResult(() => client.listProfiles());
    if (!object(data) || !Array.isArray(data.users) || data.users.some(user => !profile(user))) {
        throw profileError('invalid_profile_response', 502);
    }
    return { success: true, users: data.users };
}

function requireMutations() {
    if (process.env.RATEHAWK_PROFILE_MUTATIONS_ENABLED !== 'true') {
        throw profileError('profile_mutations_disabled', 503);
    }
}

function fields(input, required, optional = []) {
    if (!object(input) || Object.keys(input).some(field => ![...required, ...optional].includes(field))
        || required.some(field => !Object.hasOwn(input, field))) {
        throw profileError('invalid_profile_request');
    }
    return input;
}

function email(value) {
    if (typeof value !== 'string' || value.length > 254 || value !== value.trim()
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw profileError('invalid_profile_request');
    return value;
}

function name(value) {
    if (typeof value !== 'string' || value.length > 100 || !/^[\p{L}][\p{L}\p{M}\u0590-\u05FF\u0900-\u097F\u0980-\u09FF\u0E00-\u0E7F'\-,.\u2019\s]*$/u.test(value)) {
        throw profileError('invalid_profile_request');
    }
    return value;
}

function details(input) {
    const data = fields(input, ['email', 'first_name', 'last_name', 'type'], ['middle_name', 'phone']);
    if (!PROFILE_TYPES.has(data.type)) throw profileError('invalid_profile_request');
    if (data.type === 'master' && process.env.RATEHAWK_PROFILE_MASTER_ENABLED !== 'true') {
        throw profileError('profile_master_disabled', 503);
    }
    const payload = { email: email(data.email), first_name: name(data.first_name), last_name: name(data.last_name) };
    if (Object.hasOwn(data, 'middle_name')) payload.middle_name = name(data.middle_name);
    if (Object.hasOwn(data, 'phone')) {
        if (typeof data.phone !== 'string' || data.phone.length < 5 || data.phone.length > 35 || !/^\+?[0-9 ()-]+$/.test(data.phone)) {
            throw profileError('invalid_profile_request');
        }
        payload.phone = data.phone;
    }
    payload.type = data.type;
    return payload;
}

async function createProfile(input) {
    requireMutations();
    const data = details(input);
    const result = await supplierResult(() => client.createProfile(data));
    if (result !== null) throw profileError('invalid_profile_response', 502);
    return { success: true };
}

async function editProfile(input) {
    requireMutations();
    const data = details(input);
    const result = await supplierResult(() => client.editProfile(data));
    if (!object(result) || !profile(result.user) || result.user.email !== data.email) {
        throw profileError('invalid_profile_response', 502);
    }
    return { success: true, user: result.user };
}

async function changeProfile(input, method, deleteOperation = false) {
    requireMutations();
    if (deleteOperation && process.env.RATEHAWK_PROFILE_DELETE_ENABLED !== 'true') {
        throw profileError('profile_delete_disabled', 503);
    }
    const data = fields(input, ['email', 'confirm']);
    if (data.confirm !== true) throw profileError('invalid_profile_request');
    const payload = { email: email(data.email) };
    const result = await supplierResult(() => client[method](payload));
    if (result !== null) throw profileError('invalid_profile_response', 502);
    return { success: true };
}

async function disableProfile(input) {
    return changeProfile(input, 'disableProfile');
}

async function restoreProfile(input) {
    return changeProfile(input, 'restoreProfile');
}

async function deleteProfile(input) {
    return changeProfile(input, 'deleteProfile', true);
}

module.exports = {
    client, retrieveProfiles, createProfile, editProfile, disableProfile, restoreProfile, deleteProfile
};