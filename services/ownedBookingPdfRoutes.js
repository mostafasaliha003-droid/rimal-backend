const express = require('express');
const { supplierConfirmed, renderStayVoucher } = require('./stayVoucher');
const { readVoucherSnapshot } = require('./ratehawkStayVoucherSnapshot');
const {
    decryptBookingRecordPayload,
    validEncryptedBookingRecordPayload
} = require('./bookingRecordPersistence');
const { hotelbedsVoucherSnapshotMatchesBooking } = require('./hotelbedsVoucherSnapshot');
const { generateVoucher } = require('./hotelbedsVoucherService');
const { isVerifiedHotelbedsContent } = require('./hotelbedsContentPolicy');
const { hotelbedsScopeFrom } = require('./hotelbedsScope');

function queryExec(query) {
    return query && typeof query.exec === 'function' ? query.exec() : query;
}

function verifiedHotelContent(Model, hotelbedsDatabase, env, snapshot, now) {
    const language = snapshot?.binding?.contentLanguage;
    const hotelCode = snapshot?.binding?.hotelCode;
    if (!Model || !hotelbedsDatabase || !language || !Number.isSafeInteger(hotelCode)) {
        throw Object.assign(new Error('hotelbeds_voucher_content_missing'), { code: 'hotelbeds_voucher_content_missing' });
    }
    return Promise.resolve().then(async () => {
        await hotelbedsDatabase.ensureModelConnected(Model, {
            env,
            errorCode: 'hotelbeds_voucher_content_unavailable'
        });
        const query = Model.findOne({ hotelCode, language, source: 'hotelbeds_content_api' });
        const row = await queryExec(query?.lean ? query.lean() : query);
        const trustedRow = row && {
            code: row.hotelCode,
            hotelCode: row.hotelCode,
            contentHotelCode: row.hotelCode,
            contentLanguage: row.language,
            contentSource: row.source,
            contentSyncedAt: row.syncedAt,
            content: row.content
        };
        if (!isVerifiedHotelbedsContent(trustedRow, { hotelCode, language, now, requireCategory: false })) {
            throw Object.assign(new Error('hotelbeds_voucher_content_missing'), {
                code: 'hotelbeds_voucher_content_missing'
            });
        }
        return row.content;
    });
}

function escapeHtml(value) {
    return String(value ?? 'N/A').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function createOwnedBookingPdfRouter({ BookingModel, HotelbedsContentModel, hotelbedsDatabase,
    env = process.env, puppeteer, requireUser, requireAdmin,
    realm = process.env.RIMAL_AUTH_REALM,
    now = () => new Date() } = {}) {
    if (!BookingModel || typeof BookingModel.findOne !== 'function' || typeof puppeteer?.launch !== 'function'
        || typeof requireUser !== 'function' || typeof requireAdmin !== 'function'
        || !env || typeof env !== 'object' || typeof now !== 'function') {
        throw new TypeError('owned_booking_pdf_dependencies_invalid');
    }

    const router = express.Router();
    const respond = async (req, res, isAdmin) => {
        res.set({
            'Cache-Control': 'private, no-store, no-cache, must-revalidate',
            Pragma: 'no-cache',
            'X-Content-Type-Options': 'nosniff',
            'X-Robots-Tag': 'noindex, nofollow'
        });
        let browser;
        try {
            const reference = typeof req.params.reference === 'string' ? req.params.reference : '';
            if (!/^[A-Za-z0-9_-]{1,120}$/.test(reference)) return res.status(404).send('Booking not found');
            if (typeof realm !== 'string' || !/^[a-z0-9:_-]{1,100}$/i.test(realm)) {
                return res.status(503).send('Voucher unavailable');
            }
            const scope = isAdmin
                ? { realm }
                : { realm, ownerSubject: req.auth?.subject };
            if (!isAdmin && (!scope.ownerSubject || typeof scope.ownerSubject !== 'string')) {
                return res.status(401).send('Unauthorized');
            }
            let bookingQuery = BookingModel.findOne({ bookingReference: reference, ...scope });
            if (typeof bookingQuery?.select === 'function') {
                bookingQuery = bookingQuery.select('+providerHotelCode +bookingClientReference +hotelbedsVoucherSnapshotEncrypted '
                    + '+hotelbedsVoucherSnapshotProcessed +stayVoucherEncrypted +stayVoucherExpiresAt');
            }
            if (typeof bookingQuery?.lean === 'function') bookingQuery = bookingQuery.lean();
            const booking = await queryExec(bookingQuery);
            if (!booking) return res.status(404).send('Booking not found');

            if (!supplierConfirmed(booking)) return res.status(409).send('Voucher unavailable');
            const isHotelbeds = booking.provider === 'hotelbeds';
            const options = { language: req.query.language, issuedAt: new Date(now()) };
            if (isHotelbeds) {
                if (!validEncryptedBookingRecordPayload(booking.hotelbedsVoucherSnapshotEncrypted)) {
                    return res.status(409).send('Voucher unavailable');
                }
                let snapshot;
                try {
                    snapshot = decryptBookingRecordPayload(booking.hotelbedsVoucherSnapshotEncrypted, env);
                } catch {
                    return res.status(409).send('Voucher unavailable');
                }
                let trustedSupplierScope;
                try { trustedSupplierScope = hotelbedsScopeFrom(env); }
                catch { return res.status(503).send('Voucher unavailable'); }
                if (!hotelbedsVoucherSnapshotMatchesBooking(snapshot, booking, {
                    accountId: trustedSupplierScope.accountId
                })) return res.status(409).send('Voucher unavailable');
                const hotelContent = await verifiedHotelContent(
                    HotelbedsContentModel,
                    hotelbedsDatabase,
                    env,
                    snapshot,
                    new Date(now())
                );
                options.hotelbeds = generateVoucher(snapshot.confirmation, hotelContent);
            } else {
                if (!booking.supplierReference || /^pending$/i.test(booking.supplierReference)
                    || !booking.hotelName || !booking.customerName || !booking.checkInDate || !booking.checkOutDate) {
                    return res.status(409).send('Voucher unavailable');
                }
                try { options.snapshot = readVoucherSnapshot(booking, options.issuedAt, env); }
                catch { return res.status(409).send('Voucher unavailable'); }
            }
            const html = renderStayVoucher(booking, options);
            if (req.query.format === 'html') {
                res.set('Content-Security-Policy', "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
                return res.type('html').send(html);
            }

            browser = await puppeteer.launch({
                headless: true,
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath?.(),
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            const page = await browser.newPage();
            await page.setRequestInterception(true);
            page.on('request', request => {
                const embedded = request.url?.().startsWith('data:');
                (embedded ? request.continue() : request.abort()).catch(() => {});
            });
            await page.setContent(html, { waitUntil: 'domcontentloaded' });
            const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
            res.set('Content-Type', 'application/pdf');
            res.set('Content-Disposition', `attachment; filename="Pillow-Stays-Voucher-${reference}.pdf"`);
            return res.status(200).send(Buffer.from(pdf));
        } catch {
            if (!res.headersSent) return res.status(503).send('Voucher unavailable');
            return undefined;
        } finally {
            if (browser) await browser.close().catch(() => {});
        }
    };

    router.get('/bookings/pdf/:reference', requireUser, (req, res) => respond(req, res, false));
    router.get('/admin/bookings/:reference/pdf', requireAdmin, (req, res) => respond(req, res, true));
    return router;
}

module.exports = { escapeHtml, createOwnedBookingPdfRouter };