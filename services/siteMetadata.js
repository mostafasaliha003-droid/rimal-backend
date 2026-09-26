const SITE_URL = 'https://remalbookings.com';
const LANGUAGES = {
    ar: { html: 'ar', locale: 'ar_AE', title: 'رمال وفِلّها | حجوزات الفنادق', description: 'ابحث عن إقامة مناسبة مع رمال. قارن عروض الفنادق وشروط الإلغاء وإجمالي الإقامة.' },
    en: { html: 'en', locale: 'en_US', title: 'Remal | Hotel bookings', description: 'Compare hotel prices, availability, and cancellation terms with Remal.' },
    es: { html: 'es', locale: 'es_ES', title: 'Remal | Reservas de hoteles', description: 'Compara precios, disponibilidad y condiciones de cancelación de hoteles con Remal.' }
};

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function safeJson(value) {
    return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => ({
        '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029'
    })[character]);
}

function hotelFields(hotel, language) {
    const staticData = hotel?.staticData && typeof hotel.staticData === 'object' ? hotel.staticData : {};
    const translations = hotel?.translations instanceof Map
        ? Object.fromEntries(hotel.translations)
        : hotel?.translations || {};
    const translation = translations[language]?.reviewStatus === 'approved' ? translations[language] : {};
    const name = translation.name || staticData.name || hotel?.name || 'Hotel';
    const city = translation.city || staticData.city || hotel?.city || '';
    const country = translation.country || staticData.country || hotel?.country || '';
    const address = translation.address || staticData.address || hotel?.address || '';
    const description = translation.description || staticData.description || hotel?.description || '';
    const rawImage = staticData.image || hotel?.image;
    const image = typeof rawImage === 'string' && /^https:\/\//i.test(rawImage) ? rawImage : undefined;
    const rawStars = Number(staticData.stars || staticData.star_rating || hotel?.stars);
    const stars = Number.isFinite(rawStars) && rawStars >= 1 && rawStars <= 5 ? rawStars : undefined;
    return { name, city, country, address, description, image, stars };
}

function alternateLinks(path, siteUrl = SITE_URL) {
    const links = Object.keys(LANGUAGES).map(language => {
        const url = new URL(path, siteUrl);
        url.searchParams.set('lang', language);
        const hreflang = language === 'ar' ? 'ar' : language === 'en' ? 'en' : 'es';
        return `<link rel="alternate" hreflang="${hreflang}" href="${escapeHtml(url.href)}">`;
    });
    const fallback = new URL(path, siteUrl);
    fallback.searchParams.set('lang', 'en');
    links.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(fallback.href)}">`);
    return links.join('');
}

function buildHomeMetadata(language = 'ar', siteUrl = SITE_URL) {
    const locale = LANGUAGES[language] ? language : 'ar';
    const localized = LANGUAGES[locale];
    const path = '/';
    const canonical = new URL(`${path}?lang=${locale}`, siteUrl).href;
    return {
        language: localized.html,
        direction: locale === 'ar' ? 'rtl' : 'ltr',
        locale: localized.locale,
        title: localized.title,
        description: localized.description,
        canonical,
        alternates: alternateLinks(path, siteUrl),
        type: 'website',
        structuredData: { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Remal', url: canonical }
    };
}

function buildHotelMetadata({ hid, hotel, language = 'ar', siteUrl = SITE_URL }) {
    const translations = hotel?.translations instanceof Map
        ? Object.fromEntries(hotel.translations)
        : hotel?.translations || {};
    const hasApprovedTranslation = code => Boolean(
        translations[code]?.reviewStatus === 'approved' && translations[code]?.name
    );
    const locale = language === 'en' || hasApprovedTranslation(language) ? language : 'en';
    const localized = LANGUAGES[locale];
    const fields = hotelFields(hotel, locale);
    const path = `/hotel/${encodeURIComponent(String(hid))}`;
    const url = new URL(`${path}?lang=${locale}`, siteUrl);
    const location = [fields.city, fields.country].filter(Boolean).join(', ');
    const title = `${fields.name}${location ? ` — ${location}` : ''} | Remal`;
    const description = fields.description || (locale === 'ar'
        ? `استكشف تفاصيل ${fields.name}${location ? ` في ${location}` : ''} وقارن عروض الإقامة المتاحة.`
        : locale === 'es'
            ? `Descubre ${fields.name}${location ? ` en ${location}` : ''} y compara las ofertas de alojamiento disponibles.`
            : `Explore ${fields.name}${location ? ` in ${location}` : ''} and compare available room offers.`);
    const address = fields.address || location;
    const structuredData = {
        '@context': 'https://schema.org',
        '@type': 'Hotel',
        name: fields.name,
        url: url.href,
        ...(fields.description ? { description: fields.description } : {}),
        ...(fields.image ? { image: fields.image } : {}),
        ...(fields.stars ? { starRating: { '@type': 'Rating', ratingValue: fields.stars, bestRating: 5 } } : {}),
        ...(address || fields.country ? { address: {
            '@type': 'PostalAddress',
            ...(address ? { streetAddress: address } : {}),
            ...(fields.city ? { addressLocality: fields.city } : {}),
            ...(fields.country ? { addressCountry: fields.country } : {})
        } } : {})
    };
    const approvedLanguages = Object.keys(LANGUAGES).filter(code => code === 'en' || hasApprovedTranslation(code));
    const alternates = approvedLanguages.map(code => {
        const alternateUrl = new URL(path, siteUrl);
        alternateUrl.searchParams.set('lang', code);
        return `<link rel="alternate" hreflang="${code}" href="${escapeHtml(alternateUrl.href)}">`;
    });
    const defaultUrl = new URL(`${path}?lang=${approvedLanguages.includes('en') ? 'en' : approvedLanguages[0] || 'en'}`, siteUrl);
    alternates.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(defaultUrl.href)}">`);
    return {
        language: localized.html,
        direction: locale === 'ar' ? 'rtl' : 'ltr',
        locale: localized.locale,
        title,
        description,
        canonical: url.href,
        alternates: alternates.join(''),
        type: 'article',
        image: fields.image,
        structuredData
    };
}

function renderMetadata(html, metadata, { noindex = false } = {}) {
    const cleanHtml = html
        .replace(/\s*<meta\s+name=["']description["'][^>]*>/gi, '')
        .replace(/\s*<meta\s+name=["']robots["'][^>]*>/gi, '')
        .replace(/\s*<meta\s+property=["']og:[^"']+["'][^>]*>/gi, '')
        .replace(/\s*<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, '')
        .replace(/\s*<link\s+rel=["']canonical["'][^>]*>/gi, '')
        .replace(/\s*<link\s+rel=["']alternate["'][^>]*>/gi, '')
        .replace(/\s*<script\s+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, '');
    const tags = [
        `<meta name="description" content="${escapeHtml(metadata.description)}">`,
        ...(noindex ? ['<meta name="robots" content="noindex,follow">'] : []),
        `<link rel="canonical" href="${escapeHtml(metadata.canonical)}">`,
        metadata.alternates,
        `<meta property="og:type" content="${escapeHtml(metadata.type)}">`,
        `<meta property="og:locale" content="${escapeHtml(metadata.locale)}">`,
        `<meta property="og:title" content="${escapeHtml(metadata.title)}">`,
        `<meta property="og:description" content="${escapeHtml(metadata.description)}">`,
        `<meta property="og:url" content="${escapeHtml(metadata.canonical)}">`,
        ...(metadata.image ? [`<meta property="og:image" content="${escapeHtml(metadata.image)}">`] : []),
        '<meta name="twitter:card" content="summary_large_image">',
        `<meta name="twitter:title" content="${escapeHtml(metadata.title)}">`,
        `<meta name="twitter:description" content="${escapeHtml(metadata.description)}">`,
        `<script type="application/ld+json">${safeJson(metadata.structuredData)}</script>`
    ].join('');
    return cleanHtml
        .replace(/<html\b([^>]*)>/i, (match, attributes) => {
            const cleanAttributes = attributes
                .replace(/\s+lang\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')
                .replace(/\s+dir\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
            return `<html${cleanAttributes} lang="${escapeHtml(metadata.language)}" dir="${metadata.direction}">`;
        })
        .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(metadata.title)}</title>`)
        .replace(/<\/head>/i, `${tags}</head>`);
}

function buildSitemap(hotels = [], siteUrl = SITE_URL) {
    const homepage = Object.keys(LANGUAGES).map(language => {
        const url = new URL(`/?lang=${language}`, siteUrl).href;
        const alternates = Object.keys(LANGUAGES).map(code => {
            const alternateUrl = new URL(`/?lang=${code}`, siteUrl).href;
            return `<xhtml:link rel="alternate" hreflang="${code}" href="${escapeHtml(alternateUrl)}"/>`;
        }).join('');
        return `<url><loc>${escapeHtml(url)}</loc>${alternates}</url>`;
    });
    const hotelEntries = hotels.map(hotel => {
        const hid = String(hotel?.hid || '');
        if (!/^\d{1,10}$/.test(hid)) return '';
        const path = `/hotel/${encodeURIComponent(hid)}`;
        const languages = hotel.translations instanceof Map
            ? Object.fromEntries(hotel.translations)
            : hotel.translations || {};
        const alternates = Object.keys(LANGUAGES).filter(language =>
            language === 'en' || Boolean(languages[language]?.reviewStatus === 'approved' && languages[language]?.name)
        ).map(language => {
            const url = new URL(`${path}?lang=${language}`, siteUrl).href;
            return `<xhtml:link rel="alternate" hreflang="${language}" href="${escapeHtml(url)}"/>`;
        }).join('');
        const url = new URL(`${path}?lang=en`, siteUrl).href;
        return `<url><loc>${escapeHtml(url)}</loc>${alternates}</url>`;
    }).filter(Boolean);
    return '<?xml version="1.0" encoding="UTF-8"?>'
        + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'
        + [...homepage, ...hotelEntries].join('') + '</urlset>';
}

function buildRobots(siteUrl = SITE_URL) {
    return `User-agent: *\nAllow: /\nDisallow: /checkout\nDisallow: /account\nDisallow: /loyalty\nSitemap: ${new URL('/sitemap.xml', siteUrl).href}\n`;
}

module.exports = { SITE_URL, buildHomeMetadata, buildHotelMetadata, renderMetadata, buildSitemap, buildRobots };