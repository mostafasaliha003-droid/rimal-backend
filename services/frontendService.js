const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

function createFrontendRouter(projectRoot) {
    const buildRoot = path.join(projectRoot, 'frontend', 'dist');
    const publicRoot = fs.existsSync(path.join(buildRoot, 'index.html')) ? buildRoot : projectRoot;
    const router = express.Router();
    const publicFiles = ['index.html', '404.html', 'sw.js', 'manifest.webmanifest', 'offline.html', 'icon-192.png', 'icon-512.png'];
    const sendPage = (req, res) => res.sendFile('index.html', {
        root: publicRoot,
        headers: { 'Cache-Control': 'no-cache' }
    });

    router.use('/assets', express.static(path.join(publicRoot, 'assets'), { index: false, fallthrough: false }));
    for (const file of publicFiles) {
        router.get(`/${file}`, (req, res) => res.sendFile(file, {
            root: publicRoot,
            headers: { 'Cache-Control': 'no-cache' }
        }));
    }
    router.get('*', (req, res) => {
        if (req.path === '/api' || req.path.startsWith('/api/')) {
            return res.status(404).json({ success: false, error: 'NOT_FOUND' });
        }
        if (path.extname(req.path) || req.path.split('/').some(segment => segment.startsWith('.'))) {
            return res.sendStatus(404);
        }
        return sendPage(req, res);
    });
    return router;
}

module.exports = createFrontendRouter;