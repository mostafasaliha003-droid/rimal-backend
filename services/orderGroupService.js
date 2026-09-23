const client = require('./ratehawkClient');

const ORDER_FIELDS = new Set([
    'cancelled_at', 'checkin_at', 'checkout_at', 'created_at', 'free_cancellation_before',
    'modified_at', 'payment_due', 'payment_pending', 'invoice_id'
]);

function groupError(code, httpStatus = 400) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fields(value, required, optional = []) {
    if (!object(value) || Object.keys(value).some(field => ![...required, ...optional].includes(field))
        || required.some(field => !Object.hasOwn(value, field))) {
        throw groupError('invalid_order_group_request');
    }
    return value;
}

function text(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 256) {
        throw groupError('invalid_order_group_request');
    }
    return value.trim();
}

function positiveInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        throw groupError('invalid_order_group_request');
    }
    return value;
}

function lookup(input) {
    const data = fields(input, ['pagination', 'ordering'], ['search']);
    const pagination = fields(data.pagination, ['page_number', 'page_size']);
    const ordering = fields(data.ordering, ['ordering_type', 'ordering_by']);
    const query = {
        pagination: {
            page_number: positiveInteger(pagination.page_number),
            page_size: positiveInteger(pagination.page_size, 50)
        },
        ordering: {
            ordering_type: text(ordering.ordering_type),
            ordering_by: text(ordering.ordering_by)
        }
    };
    if (!['asc', 'desc'].includes(query.ordering.ordering_type) || !ORDER_FIELDS.has(query.ordering.ordering_by)) {
        throw groupError('invalid_order_group_request');
    }
    if (Object.hasOwn(data, 'search')) {
        const search = fields(data.search, [], ['agreement_number', 'invoice_id', 'created_at', 'paid_at']);
        query.search = {};
        for (const field of ['agreement_number', 'invoice_id']) {
            if (Object.hasOwn(search, field)) query.search[field] = text(search[field]);
        }
        for (const field of ['created_at', 'paid_at']) {
            if (Object.hasOwn(search, field)) {
                const dates = fields(search[field], [], ['from_date', 'to_date']);
                if (!Object.keys(dates).length) throw groupError('invalid_order_group_request');
                query.search[field] = {};
                for (const bound of ['from_date', 'to_date']) {
                    if (Object.hasOwn(dates, bound)) query.search[field][bound] = text(dates[bound]);
                }
            }
        }
    }
    return query;
}

function supplierFailure(response) {
    if (response?.credentialsMissing) throw groupError('supplier_credentials_missing', 503);
    if (response?.httpStatus === 429) {
        const seconds = Number(response.rateLimit?.secondsNumber);
        throw Object.assign(groupError('rate_limit', 429), {
            retry_after_ms: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60000
        });
    }
    if ([401, 403].includes(response?.httpStatus)
        || ['unauthorized', 'incorrect_credentials', 'no_auth_header', 'invalid_auth_header',
            'not_allowed_host', 'api_access_disabled'].includes(response?.error)) {
        throw groupError('supplier_unauthorized', 502);
    }
    const expected = {
        page_out_of_range: 400,
        invoice_not_found: 404,
        orders_not_found: 404,
        orders_already_added: 409,
        orders_are_blocked: 409,
        order_not_white_b2b_invoiceable: 409,
        different_contract_data: 409,
        invoice_not_disbandable: 409,
        invoice_already_paid: 409,
        overpay_not_enough: 409,
        payment_amount_discrepancy: 409,
        ordergroup_is_being_paid: 409
    };
    if (Object.hasOwn(expected, response?.error)) throw groupError(response.error, expected[response.error]);
    if (response?.httpStatus === 404 || response?.error === 'endpoint_not_active') {
        throw groupError('supplier_endpoint_unavailable', 502);
    }
    if (response?.httpStatus === 400 || response?.error === 'invalid_params') {
        throw groupError('supplier_request_rejected', 502);
    }
    if (response?.connectionFailed) throw groupError('supplier_connection_failed', 502);
    if (response?.error === 'unknown') throw groupError('supplier_unknown', 502);
    throw groupError('order_group_unavailable', 502);
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

function money(value) {
    return object(value) && typeof value.amount === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.amount)
        && typeof value.currency_code === 'string' && /^[A-Z]{3}$/.test(value.currency_code);
}

async function retrieveOrderGroups(input) {
    const query = lookup(input);
    const data = await supplierResult(() => client.orderGroupsInfo(query));
    if (!object(data) || !Number.isSafeInteger(data.current_page_number) || data.current_page_number < 1
        || !Number.isSafeInteger(data.total_pages) || data.total_pages < 0
        || !Number.isSafeInteger(data.total_groups) || data.total_groups < 0
        || !Array.isArray(data.groups) || data.groups.some(group =>
            !object(group) || typeof group.invoice_id !== 'string' || !group.invoice_id.trim()
            || typeof group.agreement_number !== 'string' || !money(group.amount_payable)
            || !Array.isArray(group.orders) || group.orders.some(order =>
                !object(order) || !Number.isSafeInteger(order.order_id) || order.order_id < 1
                || !['hotel', 'upsell'].includes(order.order_type)))) {
        throw groupError('invalid_order_group_response', 502);
    }
    return { success: true, ...data };
}

function requireMutations(overpay = false) {
    if (process.env.RATEHAWK_ORDER_GROUP_MUTATIONS_ENABLED !== 'true') {
        throw groupError('order_group_mutations_disabled', 503);
    }
    if (overpay && process.env.RATEHAWK_ORDER_GROUP_OVERPAY_ENABLED !== 'true') {
        throw groupError('order_group_overpay_disabled', 503);
    }
}

function orderList(value) {
    if (!Array.isArray(value) || !value.length || value.length > 100) {
        throw groupError('invalid_order_group_request');
    }
    const seen = new Set();
    return value.map(item => {
        fields(item, ['order_id', 'order_type']);
        const order_id = positiveInteger(item.order_id);
        if (!['hotel', 'upsell'].includes(item.order_type) || seen.has(`${item.order_type}:${order_id}`)) {
            throw groupError('invalid_order_group_request');
        }
        seen.add(`${item.order_type}:${order_id}`);
        return { order_id, order_type: item.order_type };
    });
}

async function createOrderGroup(input) {
    requireMutations();
    const data = fields(input, ['orders']);
    const query = { orders: orderList(data.orders) };
    const result = await supplierResult(() => client.createOrderGroup(query));
    if (!object(result) || typeof result.invoice_id !== 'string' || !result.invoice_id.trim()) {
        throw groupError('invalid_order_group_response', 502);
    }
    return { success: true, invoice_id: result.invoice_id };
}

async function changeOrderGroup(input, method) {
    requireMutations();
    const data = fields(input, ['invoice_id', 'orders']);
    const query = { invoice_id: text(data.invoice_id), orders: orderList(data.orders) };
    const result = await supplierResult(() => client[method](query));
    if (result !== null) throw groupError('invalid_order_group_response', 502);
    return { success: true };
}

async function addToOrderGroup(input) {
    return changeOrderGroup(input, 'addToOrderGroup');
}

async function removeFromOrderGroup(input) {
    return changeOrderGroup(input, 'removeFromOrderGroup');
}

async function disbandOrderGroup(input) {
    requireMutations();
    const data = fields(input, ['invoice_id', 'confirm']);
    if (data.confirm !== true) throw groupError('invalid_order_group_request');
    const query = { invoice_id: text(data.invoice_id) };
    const result = await supplierResult(() => client.disbandOrderGroup(query));
    if (result !== null) throw groupError('invalid_order_group_response', 502);
    return { success: true };
}

function decimal(value) {
    if (typeof value !== 'string' || value.length > 256 || !/^\d+(?:\.\d+)?$/.test(value)) {
        throw groupError('invalid_order_group_request');
    }
    const [whole, fraction = ''] = value.split('.');
    const trimmedFraction = fraction.replace(/0+$/, '');
    return `${whole.replace(/^0+(?=\d)/, '')}${trimmedFraction ? `.${trimmedFraction}` : ''}`;
}

async function makeOrderGroupOverpay(input) {
    requireMutations(true);
    const data = fields(input, ['invoice_id', 'amount', 'currency_code', 'confirm']);
    if (data.confirm !== true) throw groupError('invalid_order_group_request');
    const invoice_id = text(data.invoice_id);
    const currency_code = text(data.currency_code);
    if (!/^[A-Z]{3}$/.test(currency_code)) throw groupError('invalid_order_group_request');
    const amount = decimal(data.amount);
    if (amount === '0') throw groupError('invalid_order_group_request');
    const snapshot = await retrieveOrderGroups({
        pagination: { page_number: 1, page_size: 1 },
        ordering: { ordering_type: 'asc', ordering_by: 'created_at' },
        search: { invoice_id }
    });
    if (snapshot.groups.length === 0) throw groupError('invoice_not_found', 404);
    if (snapshot.total_groups !== 1 || snapshot.groups.length !== 1 || snapshot.groups[0].invoice_id !== invoice_id) {
        throw groupError('invalid_order_group_response', 502);
    }
    const balance = snapshot.groups[0].amount_payable;
    if (balance.currency_code !== currency_code) throw groupError('payment_currency_mismatch', 409);
    const payable = balance.amount;
    if (payable.startsWith('-') || decimal(payable) !== amount) {
        throw groupError('payment_amount_mismatch', 409);
    }
    const result = await supplierResult(() => client.payOrderGroupOverpay({ invoice_id, amount }));
    if (result !== null) throw groupError('invalid_order_group_response', 502);
    return { success: true };
}

module.exports = {
    client,
    retrieveOrderGroups,
    createOrderGroup,
    addToOrderGroup,
    removeFromOrderGroup,
    disbandOrderGroup,
    makeOrderGroupOverpay
};