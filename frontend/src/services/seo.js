function setMeta(attribute, key, content) {
    const escapedKey = CSS.escape(key);
    let element = document.head.querySelector(`meta[${attribute}="${escapedKey}"]`);
    if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attribute, key);
        document.head.append(element);
    }
    element.content = String(content || '');
}

function setLink(rel, href, attributes = {}) {
    const selector = rel === 'alternate'
        ? `link[rel="alternate"][hreflang="${CSS.escape(attributes.hreflang || '')}"]`
        : `link[rel="${CSS.escape(rel)}"]`;
    let element = document.head.querySelector(selector);
    if (!element) {
        element = document.createElement('link');
        element.rel = rel;
        document.head.append(element);
    }
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    element.href = href;
    return element;
}

export function setPageSeo({ title, description, canonical, locale = 'ar_AE', language, type = 'website', image, structuredData, languages = ['ar', 'en', 'es'], noindex = false }) {
    if (typeof document === 'undefined') return;
    const languageCode = ['ar', 'en', 'es'].includes(language)
        ? language
        : locale.startsWith('ar') ? 'ar' : locale.startsWith('es') ? 'es' : 'en';
    document.documentElement.lang = languageCode;
    document.documentElement.dir = languageCode === 'ar' ? 'rtl' : 'ltr';
    document.title = String(title || 'رمال وفِلّها | حجوزات الفنادق');
    setMeta('name', 'description', description);
    if (noindex) setMeta('name', 'robots', 'noindex,follow');
    else document.head.querySelector('meta[name="robots"]')?.remove();
    setMeta('property', 'og:type', type);
    setMeta('property', 'og:locale', locale);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:url', canonical);
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', description);
    if (image) setMeta('property', 'og:image', image);
    else document.head.querySelector('meta[property="og:image"]')?.remove();
    setLink('canonical', canonical);

    const pathname = new URL(canonical, window.location.origin).pathname;
    for (const link of document.head.querySelectorAll('link[data-remal-hreflang]')) link.remove();
    const available = [...new Set(languages.filter(code => ['ar', 'en', 'es'].includes(code)))];
    for (const [code, hreflang] of [
        ...available.map(code => [code, code]),
        ...(available.length ? [[available.includes('en') ? 'en' : available[0], 'x-default']] : [])
    ]) {
        const url = new URL(pathname, window.location.origin);
        url.searchParams.set('lang', code);
        const link = setLink('alternate', url.href, { hreflang });
        link.dataset.remalHreflang = 'true';
    }
    let script = document.getElementById('remal-page-structured-data');
    if (!script) {
        script = document.createElement('script');
        script.id = 'remal-page-structured-data';
        script.type = 'application/ld+json';
        document.head.append(script);
    }
    script.textContent = JSON.stringify(structuredData || {});
}