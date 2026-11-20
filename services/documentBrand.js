const fs = require('node:fs');
const path = require('node:path');

/*
 * Mkhadda (مخدة | pillow stays) identity for customer documents: booking
 * confirmations and cancellation receipts, as email and PDF. Colours follow the
 * app's design tokens (apps/mobile/src/theme.ts). Remal Group LLC FZ, the licensed
 * company, remains the operator and the contact for support. Its name is shown
 * exactly as on the licence, in Latin script in both languages.
 */
const BRAND = {
    name: 'مخدة',
    latin: 'pillow stays',
    sender: 'مخدة | pillow stays',
    support: 'management@remaltourismllc.com',
    operator: 'تديرها Remal Group LLC FZ · Operated by Remal Group LLC FZ',
};

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

function footer() {
    return `<div style="font-size:12px;line-height:1.9;color:${C.neutral600}">للمساعدة · Reservation support<br>`
        + `<a href="mailto:${BRAND.support}" style="color:${C.plum600}">${BRAND.support}</a><br>`
        + `<span>${BRAND.operator}</span></div>`;
}

module.exports = { BRAND, C, FONT_STACK, EMAIL_SYMBOL_CID, emailSymbolAttachment, embeddedAssets, pdfFontFaces, wordmark, statusPill, footer };
