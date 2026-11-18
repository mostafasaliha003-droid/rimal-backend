const fs = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { renderStayVoucher } = require('../services/stayVoucher');

// Local-only examples. Neither the supplier nor the payment API is called.
async function preview() {
    const out = path.resolve(__dirname, '../output/pdf');
    await fs.mkdir(out, { recursive: true });
    const browser = await puppeteer.launch({ headless: true, executablePath:
        process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath() });
    try {
        for (const language of ['ar', 'en']) {
            const english = language === 'en';
            const rooms = [{ roomType: english ? 'Deluxe double' : 'غرفة ديلوكس مزدوجة',
                guests: [{ name: 'Guest One · ضيف تجريبي', type: 'adult' }, { name: 'Guest Two · ضيف تجريبي', type: 'adult' }] }];
            if (english) {
                for (let index = 2; index <= 6; index++) {
                    rooms.push({ roomType: 'Family suite · غرفة عائلية',
                        guests: [{ name: 'Example Guest ' + index + ' — Alexandra-Marie A Very Long Example Family Name for Print', type: 'adult' },
                            { name: 'اسم تجريبي طويل للنزيل لاختبار الطباعة عبر الصفحات', type: 'adult' },
                            { name: 'Example child ' + index, type: 'child', age: 7 }] });
                }
            }
            const record = { bookingReference: 'DEMO-PS-2026-' + (english ? 'EN' : 'AR'),
                supplierReference: english ? 'DEMO-PARTNER-' + '1234567890'.repeat(9) : 'DEMO-PARTNER-0001',
                hotelConfirmationNumber: 'DEMO-HOTEL-0001',
                status: 'active', supplierStatus: 'CONFIRMED',
                hotelName: english ? 'Palm Cove Retreat' : 'بالم كوف ريتريت', customerName: 'Guest One · ضيف تجريبي',
                checkInDate: '2026-12-21', checkOutDate: '2026-12-23',
                cancellationPolicy: english ? 'Example cancellation policy for this design preview.' : 'شرط إلغاء تجريبي خاص بمعاينة التصميم.' };
            const snapshot = { rooms, hotelAddress: english ? 'Dubai, United Arab Emirates · Design sample' : 'دبي، الإمارات العربية المتحدة · عنوان تجريبي',
                board: english ? 'Breakfast included' : 'الإفطار مشمول',
                fees: [{ name: english ? 'Example local fee' : 'رسم محلي تجريبي', amount: '15', currency: 'AED' }],
                request: english ? 'Example request for connecting rooms.' : 'طلب تجريبي لغرفة هادئة.' };
            const html = renderStayVoucher(record, { language, snapshot, sample: true, issuedAt: new Date('2026-11-18') });
            const stem = path.join(out, 'pillow-stays-voucher-' + language);
            await fs.writeFile(stem + '.html', html);
            const page = await browser.newPage();
            await page.setContent(html);
            await page.evaluate(() => document.fonts.ready);
            await page.pdf({ path: stem + '.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true });
            await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
            if (overflow) throw new Error('Mobile voucher overflows in ' + language);
            await page.screenshot({ path: stem + '-mobile.png', fullPage: true });
            await page.close();
        }
    } finally {
        await browser.close();
    }
}
preview().catch(error => { console.error(error.message); process.exitCode = 1; });
