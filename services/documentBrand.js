const fs = require('node:fs');
const path = require('node:path');

/*
 * Pillow Stays (مخدة) identity for customer documents: booking confirmations,
 * cancellation receipts and stay vouchers, as email and PDF. Colours follow the
 * app's design tokens (apps/mobile/src/theme.ts).
 */
const BRAND = {
    name: 'مخدة',
    latin: 'Pillow Stays',
    // Where both languages appear (subjects, titles, footers).
    sender: 'Pillow Stays | مخدة',
    // The From display name on every e-mail.
    senderName: 'Pillow Stays',
    support: 'support@pillowstays.app',
};

/*
 * The licensed company, exactly as on the licence. Shown only where the law needs
 * it: invoices and receipts (confirmation with amount paid, cancellation receipt),
 * Terms, Privacy Policy and the website footer. Not on vouchers or other e-mails.
 */
const COMPANY = Object.freeze({
    name: 'REMAL GROUP L.L.C-FZ',
    nameAr: 'مجموعة ريمال ش.ذ.م.م-منطقة حرة',
    licence: '2312342.01',
    freeZone: 'Meydan Free Zone',
    address: 'Meydan Grandstand, 6th floor, Meydan Road, Nad Al Sheba, Dubai, UAE',
});

// The UAE Tax Registration Number (15 digits), from COMPANY_TRN; shown on receipts once set.
function companyTrn(env = process.env) {
    const value = String(env.COMPANY_TRN || '').replace(/\s+/g, '');
    return /^\d{15}$/.test(value) ? value : '';
}

// One line for receipts: legal name (Arabic and Latin), licence, address and TRN when set.
function companyLegalLine(env = process.env) {
    const trn = companyTrn(env);
    return `${COMPANY.nameAr} · ${COMPANY.name} · Licence ${COMPANY.licence} · ${COMPANY.address}${trn ? ` · TRN ${trn}` : ''}`;
}

/*
 * Addresses on pillowstays.app are Google Workspace aliases of the SMTP_USER mailbox, so the
 * mailbox can send as them (Gmail: Settings > Accounts > "Send mail as" must list each one, or
 * Gmail quietly rewrites From to the mailbox address).
 * - support@: customer-facing From and Reply-To.
 * - accounts@: blind copy of every e-mail that carries an invoice or receipt, so accounting
 *   keeps a copy of each one.
 */
const MAIL = Object.freeze({
    from: Object.freeze({ name: BRAND.senderName, address: BRAND.support }),
    replyTo: BRAND.support,
    accountsBcc: 'accounts@pillowstays.app',
});

// Customer e-mail headers. withAccountsCopy adds the accounting blind copy.
function customerMailHeaders({ withAccountsCopy = false } = {}) {
    return { from: { ...MAIL.from }, replyTo: MAIL.replyTo, ...(withAccountsCopy ? { bcc: MAIL.accountsBcc } : {}) };
}

// The issue date as YYYYMMDD in the UAE (Asia/Dubai, UTC+4 all year, no daylight saving).
function dubaiDateStamp(date = new Date()) {
    const time = new Date(date).getTime();
    if (!Number.isFinite(time)) throw new TypeError('document_date_invalid');
    return new Date(time + 4 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
}

/*
 * PDF attachment name with the booking reference and issue date, e.g.
 * PillowStays-Confirmation-RB123-20261128.pdf, so a copy is easy to find in any mailbox.
 */
function documentFileName(kind, reference, date = new Date()) {
    if (!/^[A-Za-z]{1,40}$/.test(kind)) throw new TypeError('document_kind_invalid');
    const ref = String(reference ?? '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    if (!ref) throw new TypeError('document_reference_invalid');
    return `PillowStays-${kind}-${ref}-${dubaiDateStamp(date)}.pdf`;
}

const C = {
    plum900: '#201626', plum800: '#2D173A', plum600: '#513069',
    cream: '#FAF8F4', sand: '#F3EFE9', white: '#FFFFFF',
    lavender50: '#F9F6FE', lavender100: '#F3EBFD', lavender300: '#C9B7F5',
    neutral600: '#675E6B', border: '#E8E1E9',
    green700: '#23674B', pistachio100: '#EFF4E6', pistachio300: '#DFE8C7',
    gold700: '#805A16', gold100: '#FBF3E4', gold200: '#EBD9B4',
};

const FONT_STACK = "'IBM Plex Sans Arabic','Plex Arabic',Tahoma,Arial,sans-serif";
const SYMBOL_PATH = path.join(__dirname, '..', 'brand', 'pillow-symbol.png');
const FONT_DIR = path.join(__dirname, '..', 'brand', 'fonts');

// Inline image for email: mail clients block data: URIs but show cid: attachments.
const EMAIL_SYMBOL_CID = 'mkhadda-symbol@pillowstays';
const emailSymbolAttachment = () => ({ filename: 'pillow-stays.png', path: SYMBOL_PATH, cid: EMAIL_SYMBOL_CID, contentDisposition: 'inline' });

let embedded;
// The PDF renderer blocks every network request, so the font and symbol are embedded.
function embeddedAssets() {
    if (!embedded) {
        const base64 = file => fs.readFileSync(file).toString('base64');
        embedded = {
            symbol: `data:image/png;base64,${base64(SYMBOL_PATH)}`,
            regular: base64(path.join(FONT_DIR, 'IBMPlexSansArabic-Regular.ttf')),
            bold: base64(path.join(FONT_DIR, 'IBMPlexSansArabic-Bold.ttf')),
        };
    }
    return embedded;
}

function pdfFontFaces() {
    const { regular, bold } = embeddedAssets();
    return `@font-face{font-family:'Plex Arabic';font-weight:400;src:url(data:font/ttf;base64,${regular}) format('truetype')}`
        + `@font-face{font-family:'Plex Arabic';font-weight:700;src:url(data:font/ttf;base64,${bold}) format('truetype')}`;
}

// Symbol beside the bilingual wordmark, as in the app header.
function wordmark(symbolSrc, { size = 44 } = {}) {
    return `<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>`
        + `<td style="padding:0 0 0 10px;vertical-align:middle"><img src="${symbolSrc}" width="${size}" height="${Math.round(size * 0.77)}" alt="" style="display:block;border:0"></td>`
        + `<td style="vertical-align:middle;text-align:center"><div style="font-family:${FONT_STACK};font-size:${Math.round(size * 0.6)}px;line-height:1.1;font-weight:700;color:${C.plum800}">${BRAND.name}</div>`
        + `<div dir="ltr" style="font-family:${FONT_STACK};font-size:${Math.round(size * 0.26)}px;letter-spacing:.4px;color:${C.plum800}">${BRAND.latin}</div></td>`
        + `</tr></table>`;
}

function statusPill(sandbox, label) {
    const [bg, fg, line] = sandbox ? [C.gold100, C.gold700, C.gold200] : [C.pistachio100, C.green700, C.pistachio300];
    return `<span style="display:inline-block;padding:4px 12px;border-radius:999px;background:${bg};color:${fg};border:1px solid ${line};font-size:12px;font-weight:700">${label}</span>`;
}

// Support contact; receipts (legal: true) add the company's legal details.
function footer({ legal = false, env = process.env } = {}) {
    return `<div style="font-size:12px;line-height:1.9;color:${C.neutral600}">للمساعدة · Reservation support<br>`
        + `<a href="mailto:${BRAND.support}" style="color:${C.plum600}">${BRAND.support}</a>`
        + (legal ? `<br><span dir="auto" style="font-size:11px">${companyLegalLine(env)}</span>` : '')
        + '</div>';
}

module.exports = { BRAND, COMPANY, companyTrn, companyLegalLine, MAIL, customerMailHeaders, dubaiDateStamp, documentFileName, C, FONT_STACK, EMAIL_SYMBOL_CID, emailSymbolAttachment, embeddedAssets, pdfFontFaces, wordmark, statusPill, footer };
