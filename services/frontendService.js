const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_CACHE_CONTROL = 'no-store, no-cache, must-revalidate, proxy-revalidate';
const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function createFrontendRouter(projectRoot) {
    const projectRootPath = path.resolve(projectRoot);
    const buildRoot = path.resolve(projectRootPath, 'frontend', 'dist');

    // Prefer the Vite build when frontend/dist/index.html exists.
    const publicRoot = fs.existsSync(path.join(buildRoot, 'index.html'))
        ? buildRoot
        : projectRootPath;

    const indexPath = path.join(publicRoot, 'index.html');
    const assetsRoot = path.join(publicRoot, 'assets');

    const router = express.Router();

    const publicFiles = [
        'index.html',
        '404.html',
        'sw.js',
        'manifest.webmanifest',
        'offline.html',
        'icon-192.png',
        'icon-512.png'
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
                return sendIndex(req, res, next);
            }
            return sendFile(path.join(publicRoot, file), res, next, { 'Cache-Control': 'no-cache' });
        });
    }

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