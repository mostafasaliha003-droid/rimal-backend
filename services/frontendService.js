const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { SITE_URL, buildHomeMetadata, buildPageMetadata, knownPage, buildHotelMetadata, renderMetadata, buildSitemap, buildRobots } = require('./siteMetadata');

const INDEX_CACHE_CONTROL = 'no-store, no-cache, must-revalidate, proxy-revalidate';
const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function createFrontendRouter(projectRoot, { Hotel, siteUrl = SITE_URL, privateMembership = false } = {}) {
    const projectRootPath = path.resolve(projectRoot);
    const buildRoot = path.resolve(projectRootPath, 'frontend', 'dist');

    // Prefer the Vite build when frontend/dist/index.html exists.
    const publicRoot = fs.existsSync(path.join(buildRoot, 'index.html'))
        ? buildRoot
        : projectRootPath;

    const indexPath = path.join(publicRoot, 'index.html');
    const assetsRoot = path.join(publicRoot, 'assets');

    const router = express.Router();
    let sitemapCache = null;
    let sitemapCachedAt = 0;

    const publicFiles = [
        'index.html',
        '404.html',
        'sw.js',
        'manifest.webmanifest',
        'offline.html',
        'icon-192.png',
        'icon-512.png',
        'pillow-symbol.png',
        'robots.txt',
        'sitemap.xml'
    ];

    const sendFile = (filePath, res, next, headers) => {
        res.sendFile(filePath, { headers }, error => {
            if (error) next(error);
        });
    };

    const sendIndex = (req, res, next) => {
        sendFile(indexPath, res, next, {
            'Cache-Control': INDEX_CACHE_CONTROL,
            'Pragma': 'no-cache',
            'Expires': '0'
        });
    };

    const languageFor = req => ['ar', 'en', 'es'].includes(req.query.lang) ? req.query.lang : 'ar';
    // The share picture is served by whichever host answered (staging or production), so a shared link
    // always shows it; the canonical address still names the public site.
    const shareImage = req => {
        const host = String(req.get('host') || '');
        if (!/^[a-z0-9.-]{1,253}(:\d{1,5})?$/i.test(host)) return null;
        return `${/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https'}://${host}/pillow/share.jpg`;
    };
    const sendSeoIndex = (req, res, next, source, options) => {
        const metadata = source.image === new URL('/pillow/share.jpg', siteUrl).href ? { ...source, image: shareImage(req) || source.image } : source;
        fs.promises.readFile(indexPath, 'utf8').then(html => {
            res.status(options?.status || 200).set({
                'Cache-Control': INDEX_CACHE_CONTROL,
                'Pragma': 'no-cache',
                'Expires': '0'
            }).type('html').send(renderMetadata(html, metadata, options));
        }).catch(next);
    };

    router.get('/robots.txt', (req, res) => {
        if(privateMembership)return res.type('text/plain').set('Cache-Control','no-store').send('User-agent: *\nDisallow: /\n');
        res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(buildRobots(siteUrl));
    });

    router.get('/sitemap.xml', async (req, res) => {
        if(privateMembership)return res.status(404).set('Cache-Control','no-store').end();
        if (!sitemapCache || Date.now() - sitemapCachedAt > 60 * 60 * 1000) {
            let hotels = [];
            if (Hotel && typeof Hotel.find === 'function') {
                try {
                    hotels = await Hotel.find({
                        provider: 'ratehawk',
                        hid: { $exists: true, $ne: null },
                        deleted: { $ne: true },
                        'staticData.deleted': { $ne: true }
                    }).select({ hid: 1, translations: 1 }).limit(49997).lean();
                } catch {
                    hotels = [];
                }
            }
            sitemapCache = buildSitemap(hotels, siteUrl);
            sitemapCachedAt = Date.now();
        }
        return res.type('application/xml').set('Cache-Control', 'public, max-age=900').send(sitemapCache);
    });

    const isAssetRequest = requestPath =>
        requestPath === '/assets' ||
        requestPath.startsWith('/assets/') ||
        requestPath === '/dist/assets' ||
        requestPath.startsWith('/dist/assets/');

    const assetMiddleware = express.static(assetsRoot, {
        index: false,
        fallthrough: true, // Crucial: Missing hashed assets fall through to SPA fallback
        setHeaders: res => {
            res.setHeader('Cache-Control', ASSET_CACHE_CONTROL);
        }
    });

    router.use(['/assets', '/dist/assets'], assetMiddleware);
    // The Mkhadda brand files: symbol, fonts (OFL) and the hero photograph.
    router.use('/pillow', express.static(path.join(publicRoot, 'pillow'), { index: false, maxAge: '1d' }));

    for (const file of publicFiles) {
        router.get(`/${file}`, (req, res, next) => {
            if (file === 'index.html') {
                return sendSeoIndex(req, res, next, buildHomeMetadata(languageFor(req), siteUrl));
            }
            return sendFile(path.join(publicRoot, file), res, next, { 'Cache-Control': 'no-cache' });
        });
    }

    router.get('/hotel/:hid', async (req, res, next) => {
        if(privateMembership)return sendSeoIndex(req,res,next,buildHomeMetadata(languageFor(req),siteUrl),{noindex:true});
        const hid = String(req.params.hid || '');
        const language = languageFor(req);
        if (!/^\d{1,10}$/.test(hid) || !Hotel || typeof Hotel.findOne !== 'function') {
            return sendSeoIndex(req, res, next, buildHomeMetadata(language, siteUrl), { noindex: true });
        }
        try {
            const hotel = await Hotel.findOne({
                provider: 'ratehawk',
                hid,
                deleted: { $ne: true },
                'staticData.deleted': { $ne: true }
            }).lean();
            if (!hotel) return sendSeoIndex(req, res, next, buildHomeMetadata(language, siteUrl), { noindex: true });
            return sendSeoIndex(req, res, next, buildHotelMetadata({ hid, hotel, language, siteUrl }));
        } catch {
            return sendSeoIndex(req, res, next, buildHomeMetadata(language, siteUrl), { noindex: true });
        }
    });

    // Signed-in and transactional pages: named in the browser tab, never indexed.
    router.get(['/checkout', '/next-gen/checkout', '/payment-status', '/mock-payment', '/account', '/loyalty', '/account-deletion', '/account-deletion-requests',
        '/bookings', '/favorites', '/notifications', '/support', '/customer-service', '/membership-admin'], (req, res, next) =>
        sendSeoIndex(req, res, next, buildPageMetadata(req.path, languageFor(req), siteUrl), { noindex: true })
    );
    // Public pages with their own title and description.
    router.get(['/membership', '/privacy', '/terms'], (req, res, next) =>
        sendSeoIndex(req, res, next, buildPageMetadata(req.path, languageFor(req), siteUrl))
    );

    router.get('/next-gen', (req, res, next) =>
        sendSeoIndex(req, res, next, buildHomeMetadata(languageFor(req), siteUrl), { noindex: true })
    );

    // Mkhadda Desk: the staff console, with its own page and install manifest. Never indexed or cached.
    const deskHeaders = { 'Cache-Control': INDEX_CACHE_CONTROL, 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };
    router.get(['/desk', '/desk/*'], (req, res, next) => {
        const desk = path.join(publicRoot, 'desk.html');
        if (!fs.existsSync(desk)) return next();
        return sendFile(desk, res, next, deskHeaders);
    });
    router.get('/desk.webmanifest', (req, res, next) => {
        const manifest = path.join(publicRoot, 'desk.webmanifest');
        if (!fs.existsSync(manifest)) return next();
        return sendFile(manifest, res, next, { 'Cache-Control': 'no-cache', 'Content-Type': 'application/manifest+json' });
    });

    router.get('/', (req, res, next) =>
        sendSeoIndex(req, res, next, buildHomeMetadata(languageFor(req), siteUrl))
    );

    router.get('*', (req, res, next) => {
        if (req.path === '/api' || req.path.startsWith('/api/')) {
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }
        if (isAssetRequest(req.path)) {
            return sendIndex(req, res, next);
        }
        if (path.extname(req.path) || req.path.split('/').some(segment => segment.startsWith('.'))) {
            return res.sendStatus(404);
        }
        if (knownPage(req.path)) return sendIndex(req, res, next);
        // An address the site does not have: the app shows its "not found" page, and the answer says 404.
        return sendSeoIndex(req, res, next, buildPageMetadata(req.path, languageFor(req), siteUrl), { noindex: true, status: 404 });
    });

    return router;
}

module.exports = createFrontendRouter;
