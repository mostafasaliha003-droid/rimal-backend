const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = __dirname;
const frontendRoot = path.join(root, 'frontend');
const publicFiles = ['sw.js', 'offline.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const protectedDeploymentPaths = [
    '404.html', 'admin.html', 'assets', 'CNAME', '.nojekyll', 'icon-192.png', 'icon-512.png',
    'index.html', 'js', 'logo.jpg', 'manifest.json', 'manifest.webmanifest', 'offline.html',
    'robots.txt', 'sitemap.xml', 'style.css', 'sw.js', 'frontend/dist'
];

async function snapshotFiles(paths) {
    const snapshot = new Map();
    async function visit(current) {
        let entries;
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        } catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
        }
        for (const entry of entries) {
            const target = path.join(current, entry.name);
            if (entry.isDirectory()) {
                await visit(target);
            } else if (entry.isFile()) {
                const relative = path.relative(root, target).split(path.sep).join('/');
                const content = await fs.readFile(target);
                snapshot.set(relative, crypto.createHash('sha256').update(content).digest('hex'));
            }
        }
    }
    for (const item of paths) {
        const absolute = path.join(root, item);
        try {
            const stat = await fs.stat(absolute);
            if (stat.isDirectory()) await visit(absolute);
            else if (stat.isFile()) {
                const content = await fs.readFile(absolute);
                snapshot.set(item.split(path.sep).join('/'), crypto.createHash('sha256').update(content).digest('hex'));
            }
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    return snapshot;
}

async function copyPwaAssets(output) {
    for (const file of publicFiles) {
        await fs.copyFile(path.join(frontendRoot, 'public', file), path.join(output, file));
    }
}

async function getPreviewOrigin(server) {
    const address = server.httpServer.address();
    if (address && typeof address === 'object') return `http://127.0.0.1:${address.port}`;
    const urls = server.resolvedUrls?.local || [];
    const origin = urls.map(value => {
        try { return new URL(value).origin; } catch { return null; }
    }).find(Boolean);
    if (!origin) throw new Error('isolated_vite_preview_origin_unavailable');
    return origin;
}

async function waitForPreview(origin, server) {
    let lastError;
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (!server.httpServer.listening) throw new Error('isolated_vite_preview_closed_before_ready');
        try {
            const response = await fetch(origin);
            if (response.status === 200) return;
            lastError = new Error(`preview_status_${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`isolated_vite_preview_not_ready: ${lastError?.message || 'unknown'}`);
}

async function run() {
    const baseline = await snapshotFiles(protectedDeploymentPaths);
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'remal-frontend-verify-'));
    const output = path.join(tempRoot, 'dist');
    const screenshots = path.join(tempRoot, 'screenshots');
    const originalCwd = process.cwd();
    const envKeys = ['REMAL_VITE_OUT_DIR', 'REMAL_UI_TEST_BASE', 'REMAL_UI_SCREENSHOT_DIR'];
    const priorEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
    let preview;
    let success = false;
    let verificationError;
    try {
        await fs.mkdir(output, { recursive: true });
        process.chdir(frontendRoot);
        process.env.REMAL_VITE_OUT_DIR = output;
        process.env.REMAL_UI_SCREENSHOT_DIR = screenshots;

        const requireFrontend = require('node:module').createRequire(path.join(frontendRoot, 'package.json'));
        const viteUrl = pathToFileURL(requireFrontend.resolve('vite')).href;
        const configUrl = pathToFileURL(path.join(frontendRoot, 'vite.config.js')).href;
        const [{ build, preview: createPreview }, { default: configure }] = await Promise.all([
            import(viteUrl), import(configUrl)
        ]);
        const config = configure({ command: 'build', mode: 'production' });
        await build({
            ...config,
            configFile: false,
            root: frontendRoot,
            build: { ...config.build, outDir: output, emptyOutDir: true, sourcemap: false },
            logLevel: 'warn'
        });
        const [builtIndex, builtFallback] = await Promise.all([
            fs.readFile(path.join(output, 'index.html'), 'utf8'),
            fs.readFile(path.join(output, '404.html'), 'utf8')
        ]);
        assert.equal(builtFallback, builtIndex, 'Vite must emit a matching isolated 404.html');
        await copyPwaAssets(output);

        const previewConfig = configure({ command: 'serve', mode: 'production' });
        preview = await createPreview({
            ...previewConfig,
            configFile: false,
            root: frontendRoot,
            build: { ...previewConfig.build, outDir: output },
            preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false },
            logLevel: 'warn'
        });
        const origin = await getPreviewOrigin(preview);
        process.env.REMAL_UI_TEST_BASE = origin;
        await waitForPreview(origin, preview);
        console.log(`Isolated Vite preview ready at ${origin}`);

        const { run: runBrowserTests } = require(path.join(root, 'test-ui.cjs'));
        await runBrowserTests();
        await require(path.join(root, 'test-support-ui.cjs')).run();
        success = true;
    } catch (error) {
        verificationError = error;
    } finally {
        for (const key of envKeys) {
            if (priorEnv[key] === undefined) delete process.env[key];
            else process.env[key] = priorEnv[key];
        }
        try {
            if (preview) await preview.close();
        } catch (error) {
            verificationError ||= error;
            success = false;
        }
        process.chdir(originalCwd);
        try {
            const current = await snapshotFiles(protectedDeploymentPaths);
            assert.deepEqual(current, baseline, 'protected deployment files changed during isolated verification');
        } catch (error) {
            verificationError ||= error;
            success = false;
        }
        try {
            await fs.rm(tempRoot, { recursive: true, force: true });
        } catch (error) {
            verificationError ||= error;
            success = false;
        }
    }
    if (!success) throw verificationError || new Error('isolated_frontend_verification_failed');
    console.log(`PASS: isolated production build and browser suite; ${baseline.size} protected deployment files unchanged.`);
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
