const express = require('express');
const fs = require('node:fs');

function escapeHtml(value) {
    return String(value ?? 'N/A').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function createOwnedBookingPdfRouter({ BookingModel, puppeteer, templatePath, requireUser, requireAdmin,
    realm = process.env.RIMAL_AUTH_REALM, sanitizeText = value => String(value || 'N/A') } = {}) {
    if (!BookingModel || typeof BookingModel.findOne !== 'function' || typeof puppeteer?.launch !== 'function'
        || typeof templatePath !== 'string' || typeof requireUser !== 'function' || typeof requireAdmin !== 'function'
        || typeof sanitizeText !== 'function') throw new TypeError('owned_booking_pdf_dependencies_invalid');

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
            const booking = await BookingModel.findOne({ bookingReference: reference, ...scope }).lean();
            if (!booking) return res.status(404).send('Booking not found');

            let html = fs.readFileSync(templatePath, 'utf8');
            const cleanHotelName = sanitizeText(booking.hotelName);
            const replacements = {
                bookingReference: booking.bookingReference,
                bookingStatus: ['cancelled', 'canceled'].includes(String(booking.status).toLowerCase())
                    ? 'ملغي'
                    : ['ON_REQUEST', 'PENDING'].includes(String(booking.supplierStatus || '').toUpperCase())
                        ? 'بانتظار تأكيد الفندق — غير مؤكّد بعد'
                        : booking.status === 'active' || booking.supplierStatus === 'CONFIRMED'
                            ? 'مؤكد'
                            : booking.status === 'pending'
                                ? 'بانتظار تأكيد الفندق — غير مؤكّد بعد'
                            : 'الحالة قيد المراجعة',
                priceLabel: booking.supplierPaymentType === 'AT_HOTEL' || booking.paymentMethod === 'hotel'
                    ? 'السعر المحجوز — الدفع عند الوصول إلى الفندق'
                    : 'إجمالي المبلغ',
                hotelName: cleanHotelName,
                encodedHotelName: encodeURIComponent(cleanHotelName),
                customerName: booking.customerName,
                customerPhone: booking.phone,
                customerEmail: booking.email,
                roomBed: booking.roomType || 'غرفة فندقية',
                boardType: booking.boardType,
                price: Number.isFinite(Number(booking.price)) ? String(booking.price) : 'N/A',
                priceCurrency: /^[A-Z]{3}$/.test(booking.priceCurrency || '') ? booking.priceCurrency : 'AED',
                checkInDate: /^\d{4}-\d{2}-\d{2}$/.test(booking.checkInDate || '') ? booking.checkInDate : 'غير متاح',
                checkOutDate: /^\d{4}-\d{2}-\d{2}$/.test(booking.checkOutDate || '') ? booking.checkOutDate : 'غير متاح',
                policyText: sanitizeText(booking.cancellationPolicy)
            };
            for (const [key, value] of Object.entries(replacements)) {
                const safe = key === 'encodedHotelName' ? value : escapeHtml(value);
                html = html.replaceAll(`{{${key}}}`, safe || 'N/A');
            }

            browser = await puppeteer.launch({
                headless: true,
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath?.(),
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            const page = await browser.newPage();
            await page.setRequestInterception(true);
            page.on('request', request => request.abort().catch(() => {}));
            await page.setContent(html, { waitUntil: 'domcontentloaded' });
            const pdf = await page.pdf({ format: 'A4', printBackground: true,
                margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' } });
            res.set('Content-Type', 'application/pdf');
            res.set('Content-Disposition', `attachment; filename="Rimal-Voucher-${reference}.pdf"`);
            return res.status(200).send(pdf);
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