const documentBrand = require('./documentBrand');

/*
 * "The Mkhadda team replied": the e-mail a guest gets when the team answers in Mkhadda care, so a
 * reply is never missed while the app is closed (the app has no phone notifications yet). It quotes
 * the start of the reply and tells the guest where to read and answer it.
 */
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderSupportReply({ name = '', hotelName = '', reference = '', body = '' }) {
    const { C, FONT_STACK, BRAND, wordmark, footer, EMAIL_SYMBOL_CID } = documentBrand;
    const excerpt = String(body).trim().slice(0, 400) + (String(body).trim().length > 400 ? '…' : '');
    const subject = `${BRAND.sender} | ردّ فريق مخدة على رسالتك · The Mkhadda team replied`;
    const text = `ردّ فريق مخدة على رسالتك بخصوص حجزك${hotelName ? ` في ${hotelName}` : ''} (${reference}).\n\n${excerpt}\n\n`
        + 'افتح تطبيق مخدة ← الدعم لقراءة الرد كاملاً والرد عليه.\n\n'
        + `The Mkhadda team replied about your booking${hotelName ? ` at ${hotelName}` : ''} (${reference}). Open the Mkhadda app > Support to read the full reply and answer.`;
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"></head>`
        + `<body style="margin:0;background:${C.cream};font-family:${FONT_STACK};color:${C.plum900}">`
        + `<table role="presentation" width="100%"><tr><td align="center" style="padding:28px 12px">`
        + `<table role="presentation" width="100%" style="max-width:600px;background:${C.white};border-radius:24px;overflow:hidden" cellspacing="0">`
        + `<tr><td style="padding:24px 28px;border-bottom:1px solid ${C.border}">${wordmark(`cid:${EMAIL_SYMBOL_CID}`, { size: 38 })}</td></tr>`
        + `<tr><td style="padding:28px">`
        + `<p style="margin:0 0 6px;color:${C.neutral600};font-size:14px">${escapeHtml(name)}</p>`
        + `<h1 style="margin:0 0 10px;font-size:24px;line-height:1.5;color:${C.plum800}">ردّ فريق مخدة على رسالتك</h1>`
        + `<p style="margin:0 0 18px;font-size:15px;line-height:1.9">بخصوص حجزك${hotelName ? ` في <b>${escapeHtml(hotelName)}</b>` : ''} · <span dir="ltr">${escapeHtml(reference)}</span></p>`
        + `<div style="padding:16px 18px;border-radius:16px;background:${C.lavender50};border-right:4px solid ${C.plum600};font-size:15px;line-height:1.9;white-space:pre-line">${escapeHtml(excerpt)}</div>`
        + `<p style="margin:18px 0 0;font-size:15px;line-height:1.9">افتح تطبيق مخدة ← <b>الدعم</b> لقراءة الرد كاملاً والرد عليه.</p>`
        + `<p dir="ltr" style="margin:18px 0 0;text-align:left;font-size:14px;line-height:1.8;color:${C.neutral600}"><b>The Mkhadda team replied.</b> Open the Mkhadda app &gt; Support to read the full reply and answer.</p>`
        + `</td></tr><tr><td style="padding:20px 28px;background:${C.sand}">${footer()}</td></tr>`
        + `</table></td></tr></table></body></html>`;
    return { subject, text, html };
}

module.exports = { renderSupportReply };
