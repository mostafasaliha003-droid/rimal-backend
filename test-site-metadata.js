const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    buildHomeMetadata,
    buildHotelMetadata,
    renderMetadata,
    buildSitemap,
    buildRobots
} = require('./services/siteMetadata');

const html = '<!doctype html><html lang="ar" dir="rtl"><head><title>Old</title><meta name="description" content="Old"></head><body></body></html>';

test('home pages receive language-specific crawlable metadata', () => {
    const metadata = buildHomeMetadata('es');
    const output = renderMetadata(html, metadata);
    assert.match(output, /<html lang="es" dir="ltr">/);
    assert.match(output, /<title>Remal \| Reservas de hoteles<\/title>/);
    assert.match(output, /rel="canonical" href="https:\/\/remalbookings\.com\/\?lang=es"/);
    assert.match(output, /hreflang="x-default"/);
    assert.match(output, /application\/ld\+json/);
    assert.match(metadata.structuredData.url, /\?lang=es$/);
});

test('hotel SEO uses only approved translation text and escapes supplier content', () => {
    const hotel = {
        hid: '123456', name: 'Original & Safe Hotel', city: 'Dubai', stars: '5',
        translations: {
            ar: { name: '<img src=x onerror=alert(1)>', description: 'Unreviewed', reviewStatus: 'pending' },
            es: { name: 'Hotel Seguro', description: 'Descripción aprobada', reviewStatus: 'approved' }
        }
    };
    const metadata = buildHotelMetadata({ hid: '123456', hotel, language: 'ar' });
    const output = renderMetadata(html, metadata);
    assert.match(metadata.title, /Original & Safe Hotel/);
    assert.doesNotMatch(output, /<img src=x/);
    assert.match(output, /hreflang="es"/);
    assert.doesNotMatch(output, /hreflang="ar"/);
    assert.match(output, /"ratingValue":5/);
    assert.match(output, /<meta property="og:type" content="article">/);

    const spanish = buildHotelMetadata({ hid: '123456', hotel, language: 'es' });
    assert.match(spanish.title, /Hotel Seguro/);
    assert.match(spanish.description, /Descripción aprobada/);
});

test('sitemap and robots publish only supported hotel language variants and exclude private routes', () => {
    const sitemap = buildSitemap([
        { hid: '123', translations: { ar: { name: 'فندق', reviewStatus: 'approved' }, es: { reviewStatus: 'pending' } } },
        { hid: '../private' }
    ]);
    assert.match(sitemap, /hotel\/123\?lang=en/);
    assert.match(sitemap, /hreflang="ar"/);
    assert.doesNotMatch(sitemap, /hotel%2F|private/);
    assert.doesNotMatch(sitemap, /hreflang="es" href="https:\/\/remalbookings\.com\/hotel\/123/);
    assert.match(buildRobots(), /Disallow: \/checkout/);
    assert.match(buildRobots(), /Sitemap: https:\/\/remalbookings\.com\/sitemap\.xml/);
});

test('private page metadata can opt out of indexing', () => {
    assert.match(renderMetadata(html, buildHomeMetadata('en'), { noindex: true }), /name="robots" content="noindex,follow"/);
});