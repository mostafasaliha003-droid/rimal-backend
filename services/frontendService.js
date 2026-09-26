const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { SITE_URL, buildHomeMetadata, buildHotelMetadata, renderMetadata, buildSitemap, buildRobots } = require('./siteMetadata');

const INDEX_CACHE_CONTROL = 'no-store, no-cache, must-revalidate, proxy-revalidate';
const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function createFrontendRouter(projectRoot, { Hotel, siteUrl = SITE_URL } = {}) {
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
    const sendSeoIndex = (req, res, next, metadata, options) => {
        fs.promises.readFile(indexPath, 'utf8').then(html => {
            res.set({
                'Cache-Control': INDEX_CACHE_CONTROL,
                'Pragma': 'no-cache',
                'Expires': '0'
            }).type('html').send(renderMetadata(html, metadata, options));
        }).catch(next);
    };

    router.get('/robots.txt', (req, res) => {
        res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(buildRobots(siteUrl));
    });

    router.get('/sitemap.xml', async (req, res) => {
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

    for (const file of publicFiles) {
        router.get(`/${file}`, (req, res, next) => {
            if (file === 'index.html') {
                return sendSeoIndex(req, res, next, buildHomeMetadata(languageFor(req), siteUrl));
            }
            return sendFile(path.join(publicRoot, file), res, next, { 'Cache-Control': 'no-cache' });
        });
    }

    router.get('/hotel/:hid', async (req, res, next) => {
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

    router.get(['/checkout', '/account', '/loyalty'], (req, res, next) =>
        sendSeoIndex(req, res, next, buildHomeMetadata(languageFor(req), siteUrl), { noindex: true })
    );

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
        return sendIndex(req, res, next);
    });

    return router;
}

module.exports = createFrontendRouter;