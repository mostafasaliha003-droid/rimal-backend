const crypto = require('node:crypto');
const mongoose = require('mongoose');
const InvoiceArchiveDelivery = require('../models/InvoiceArchiveDelivery');

const RECIPIENT = 'connect@remaltourismllc.com';
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const WRITE_CONCERN = Object.freeze({ w: 'majority', j: true, wtimeout: 10000 });
const fail = code => Object.assign(new Error(code), { code });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const positive = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;
const invoiceIdValid = value => typeof value === 'string' && value.length > 0 && value.length <= 256
    && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const knownCodes = new Set(['rate_limit', 'invoice_not_found', 'invoice_not_available', 'terminal_invoice',
    'order_not_assigned', 'pending', 'failed_to_generate_document', 'supplier_unauthorized',
    'supplier_credentials_missing', 'supplier_endpoint_unavailable', 'supplier_connection_failed',
    'supplier_request_rejected', 'supplier_unknown', 'invalid_document_response', 'document_unavailable',
    'page_out_of_range', 'invalid_order_group_response', 'order_group_unavailable']);
const safeCode = error => knownCodes.has(error?.code) ? error.code : 'operation_unavailable';

function pdfStructurePlausible(value) {
    if (!Buffer.isBuffer(value) || value.length < 32 || value.length > MAX_PDF_BYTES
        || !/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(value.subarray(0, 16).toString('latin1'))) return false;
    const tail = value.subarray(Math.max(0, value.length - 2048)).toString('latin1');
    if (!/startxref[\t\r\n ]+\d+[\t\r\n ]+%%EOF[\t\r\n\f\0 ]*$/.test(tail)) return false;
    const contents = value.toString('latin1');
    // Reject obvious truncation/error bodies. These structural markers are not
    // a complete PDF parser or proof of document authenticity/renderability.
    return /\b\d+\s+\d+\s+obj\b/.test(contents) && /\bendobj\b/.test(contents);
}

function deriveSupplierScope(baseUrl, keyId) {
    let url;
    try { url = new URL(baseUrl); } catch { throw fail('archive_configuration_invalid'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
        || !['api.ratehawk.com', 'api-sandbox.ratehawk.com'].includes(url.hostname)
        || !['', '/', '/api/b2b/v3', '/api/b2b/v3/'].includes(url.pathname)
        || typeof keyId !== 'string' || !keyId.trim() || /[\u0000-\u001f\u007f]/.test(keyId)) throw fail('archive_configuration_invalid');
    return { environment: url.hostname === 'api.ratehawk.com' ? 'production' : 'sandbox', scope: hash(`${url.origin}\n${keyId}`) };
}

// Inventory invokes only the injected read-only supplier listing. Database and
// SMTP are touched only by an explicit run({send:true}) after complete inventory.
function createInvoiceArchiveService({ Model = InvoiceArchiveDelivery, database = mongoose.connection,
    realm, supplierScope, retrieveOrderGroups, downloadInvoice, sendInvoice, now = () => new Date(),
    createClaim = () => crypto.randomUUID(), maxPages = 1000, maxInvoices = 50000,
    maxDeliveries = 100, leaseMs = 5 * 60 * 1000 } = {}) {
    if (typeof realm !== 'string' || !/^[a-z0-9:_-]{1,100}$/i.test(realm)
        || typeof supplierScope !== 'string' || !/^[a-f0-9]{64}$/.test(supplierScope)
        || typeof retrieveOrderGroups !== 'function' || typeof now !== 'function' || typeof createClaim !== 'function'
        || !positive(maxPages, 10000) || !positive(maxInvoices, 500000) || !positive(maxDeliveries, 50000)
        || !positive(leaseMs, 60 * 60 * 1000)) throw fail('archive_configuration_invalid');
    let indexesReady;
    const at = () => { const value = new Date(now()); if (!Number.isFinite(value.getTime())) throw fail('archive_clock_invalid'); return value; };
    async function ready() {
        if (!Model || typeof Model.init !== 'function' || typeof Model.createIndexes !== 'function'
            || typeof Model.findOne !== 'function' || typeof Model.create !== 'function'
            || typeof Model.findOneAndUpdate !== 'function' || typeof Model.updateOne !== 'function'
            || database?.readyState !== 1 || typeof downloadInvoice !== 'function' || typeof sendInvoice !== 'function') throw fail('archive_delivery_unavailable');
        if (!indexesReady) indexesReady = Promise.resolve().then(async () => {
            await Model.init();
            // Explicitly build only the ledger indexes even when the caller has
            // disabled global Mongo autoCreate/autoIndex for unrelated models.
            await Model.createIndexes();
        }).catch(() => { indexesReady = null; throw fail('archive_delivery_unavailable'); });
        await indexesReady;
        if (database.readyState !== 1) throw fail('archive_delivery_unavailable');
    }
    async function inventory() {
        const ids = new Set(); let pagesRead = 0, expected = null, pages = null;
        const result = (complete, codes = []) => ({ complete, invoiceIds: complete ? [...ids] : [],
            summary: { inventory_complete: complete, pages_read: pagesRead, invoices_observed: ids.size,
                expected_invoices: expected, codes } });
        for (let page = 1; page <= maxPages; page++) {
            let data;
            try { data = await retrieveOrderGroups({ pagination: { page_number: page, page_size: 50 },
                ordering: { ordering_type: 'asc', ordering_by: 'created_at' } }); }
            catch (error) { return result(false, ['inventory_page_failed', safeCode(error)]); }
            pagesRead++;
            if (data?.success !== true || !Array.isArray(data.groups) || data.groups.length > 50
                || data.current_page_number !== page || !Number.isSafeInteger(data.total_pages) || data.total_pages < 0
                || !Number.isSafeInteger(data.total_groups) || data.total_groups < 0) return result(false, ['inventory_response_invalid']);
            if (expected === null) { expected = data.total_groups; pages = data.total_pages; }
            if (expected !== data.total_groups || pages !== data.total_pages) return result(false, ['inventory_changed']);
            if (pages > maxPages || expected > maxInvoices) return result(false, ['inventory_limit_reached']);
            if (page > Math.max(1, pages) || pages !== Math.ceil(expected / 50)) return result(false, ['inventory_pagination_invalid']);
            for (const group of data.groups) {
                if (!invoiceIdValid(group?.invoice_id) || ids.has(group.invoice_id)) return result(false, ['inventory_duplicate_or_invalid_id']);
                ids.add(group.invoice_id);
            }
            if (ids.size > maxInvoices || ids.size > expected) return result(false, ['inventory_count_invalid']);
            if (page >= pages) return ids.size === expected ? result(true) : result(false, ['inventory_count_invalid']);
            if (data.groups.length !== 50) return result(false, ['inventory_count_invalid']);
        }
        return result(false, ['inventory_limit_reached']);
    }
    const filterFor = invoiceId => ({ realm, supplier: 'ratehawk', invoiceId, recipient: RECIPIENT });
    async function read(filter) { return Model.findOne(filter).maxTimeMS(10000).lean(); }
    function matches(row, filter) {
        return row && Object.entries(filter).every(([key, value]) => row[key] === value) && row.supplierScope === supplierScope
            && ['pending', 'sending', 'sent', 'unknown', 'failed'].includes(row.state)
            && (row.state !== 'sent' || typeof row.pdfSha256 === 'string' && /^[a-f0-9]{64}$/.test(row.pdfSha256)
                && Number.isSafeInteger(row.pdfBytes) && row.pdfBytes >= 32 && row.pdfBytes <= MAX_PDF_BYTES
                && row.pdfValidation === 'header-objects-eof-v1'
                && typeof row.messageId === 'string' && row.messageId.length > 0 && row.messageId.length <= 1024
                && !/[\u0000-\u001f\u007f]/.test(row.messageId) && row.sentAt != null && Number.isFinite(new Date(row.sentAt).getTime()));
    }
    async function entry(invoiceId) {
        const filter = filterFor(invoiceId);
        let row = await read(filter);
        if (!row) {
            try {
                const created = await Model.create([{ ...filter, supplierScope, state: 'pending', retryable: true, attempts: 0 }],
                    { ordered: true, writeConcern: WRITE_CONCERN });
                row = Array.isArray(created) && created.length === 1 ? created[0] : null;
            } catch (error) { if (error?.code !== 11000) throw error; row = await read(filter); }
        }
        if (!matches(row, filter)) throw fail('archive_scope_or_record_mismatch');
        return { row, filter: { ...filter, supplierScope } };
    }
    async function update(filter, fields, unset = {}) {
        const result = await Model.updateOne(filter, { $set: fields, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
            { writeConcern: WRITE_CONCERN });
        if (result?.acknowledged !== true || result.matchedCount !== 1) throw fail('archive_ledger_update_unconfirmed');
    }
    async function uncertain(filter, code) {
        try { await update({ ...filter, state: { $in: ['sending', 'sent'] } },
            { state: 'unknown', phase: 'review_required', retryable: false, errorCode: code }, { leaseUntil: '' }); }
        catch { /* Retained sending/sent claim still prevents an automatic resend. */ }
        return { outcome: 'unknown', code };
    }
    async function deliver(invoiceId) {
        const { row, filter } = await entry(invoiceId);
        if (row.state === 'sent') return { outcome: 'already_sent' };
        if (row.state === 'unknown' || row.state === 'failed' && row.retryable !== true) return { outcome: 'unknown', code: 'archive_manual_review_required' };
        if (row.state === 'sending') {
            if (row.leaseUntil && new Date(row.leaseUntil).getTime() > at().getTime()) return { outcome: 'busy' };
            return uncertain({ ...filter, claimId: row.claimId }, 'archive_stale_claim');
        }
        const claimId = createClaim();
        if (typeof claimId !== 'string' || !/^[a-f0-9-]{36}$/i.test(claimId)) throw fail('archive_claim_invalid');
        const claimedAt = at();
        const claimed = await Model.findOneAndUpdate({ ...filter, state: row.state,
            ...(row.state === 'failed' ? { retryable: true } : {}) }, {
            $set: { state: 'sending', phase: 'downloading', claimId, leaseUntil: new Date(claimedAt.getTime() + leaseMs), retryable: false },
            $inc: { attempts: 1 }, $unset: { errorCode: '' }
        }, { new: true, writeConcern: WRITE_CONCERN }).lean();
        if (!claimed) return { outcome: 'busy' };
        const claim = { ...filter, claimId };
        let pdf;
        try {
            pdf = await downloadInvoice({ invoice_id: invoiceId });
            if (!pdfStructurePlausible(pdf)) throw fail('invalid_document_response');
        } catch (error) {
            const code = safeCode(error);
            const pending = [202, 409, 429].includes(error?.httpStatus);
            try {
                await update({ ...claim, state: 'sending' }, { state: pending ? 'pending' : 'failed',
                    phase: 'download_not_sent', retryable: true, errorCode: code }, { leaseUntil: '', claimId: '' });
                return { outcome: pending ? 'pending' : 'failed', code };
            } catch { return uncertain(claim, 'archive_ledger_update_unconfirmed'); }
        }
        const pdfSha256 = hash(pdf);
        try {
            await update({ ...claim, state: 'sending', leaseUntil: { $gt: at() } },
                { phase: 'smtp_inflight', pdfSha256, pdfBytes: pdf.length, pdfValidation: 'header-objects-eof-v1' });
        } catch { return uncertain(claim, 'archive_before_smtp_unconfirmed'); }
        let sent;
        try {
            sent = await sendInvoice({ recipient: RECIPIENT, filename: 'RateHawk-Invoice.pdf', pdfBuffer: pdf,
                subject: 'Remal | Supplier invoice archive', text: 'Actual supplier invoice attached for the company archive.' });
        } catch { return uncertain(claim, 'archive_smtp_outcome_unknown'); }
        const accepted = Array.isArray(sent?.accepted) && sent.accepted.some(value => typeof value === 'string' && value.toLowerCase() === RECIPIENT);
        const rejected = Array.isArray(sent?.rejected) && sent.rejected.some(value => typeof value === 'string' && value.toLowerCase() === RECIPIENT);
        if (rejected && !accepted) {
            try {
                await update({ ...claim, state: 'sending' }, { state: 'failed', phase: 'smtp_rejected', retryable: true,
                    errorCode: 'archive_smtp_rejected' }, { leaseUntil: '', claimId: '' });
                return { outcome: 'failed', code: 'archive_smtp_rejected' };
            } catch { return uncertain(claim, 'archive_ledger_update_unconfirmed'); }
        }
        if (!accepted || rejected || typeof sent.messageId !== 'string' || !sent.messageId || sent.messageId.length > 1024
            || /[\u0000-\u001f\u007f]/.test(sent.messageId)) return uncertain(claim, 'archive_smtp_outcome_unknown');
        try {
            await update({ ...claim, state: 'sending' }, { state: 'sent', phase: 'complete', retryable: false,
                messageId: sent.messageId, sentAt: at() }, { leaseUntil: '' });
            return { outcome: 'sent' };
        } catch { return uncertain(claim, 'archive_after_smtp_unconfirmed'); }
    }
    async function run({ send = false } = {}) {
        if (typeof send !== 'boolean') throw fail('archive_configuration_invalid');
        const found = await inventory();
        const summary = { ...found.summary, delivery_requested: send, sent: 0, already_sent: 0,
            pending: 0, unknown: 0, failed: 0, busy: 0, deferred: 0, all_inventoried_invoices_sent: false };
        const codes = new Set(summary.codes);
        if (!found.complete || !send) return summary;
        if (!found.invoiceIds.length) { summary.all_inventoried_invoices_sent = true; return summary; }
        try { await ready(); } catch { summary.codes = ['archive_delivery_unavailable']; return summary; }
        let deliveries = 0;
        for (const invoiceId of found.invoiceIds) {
            let result;
            try {
                const existing = await read(filterFor(invoiceId));
                if (existing && !matches(existing, filterFor(invoiceId))) result = { outcome: 'failed', code: 'archive_scope_or_record_mismatch' };
                else if (existing?.state === 'sent') result = { outcome: 'already_sent' };
                else if (existing && (['unknown', 'sending'].includes(existing.state)
                    || existing.state === 'failed' && existing.retryable !== true)) result = await deliver(invoiceId);
                else if (deliveries >= maxDeliveries) { summary.deferred++; continue; }
                else { deliveries++; result = await deliver(invoiceId); }
            } catch (error) { result = { outcome: 'failed', code: error?.code === 'archive_scope_or_record_mismatch'
                ? 'archive_scope_or_record_mismatch' : 'archive_delivery_unavailable' }; }
            summary[result.outcome]++;
            if (result.code) codes.add(result.code);
        }
        summary.codes = [...codes];
        summary.all_inventoried_invoices_sent = summary.sent + summary.already_sent === found.invoiceIds.length;
        return summary;
    }
    return { inventory, run };
}

module.exports = { RECIPIENT, MAX_PDF_BYTES, WRITE_CONCERN, deriveSupplierScope, pdfStructurePlausible, createInvoiceArchiveService };
