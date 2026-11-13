import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const githubPagesFallbackPlugin = () => {
    let outputDirectory;
    return {
        name: 'github-pages-fallback',
        configResolved(config) {
            outputDirectory = config.build.outDir;
        },
        closeBundle() {
            const dist = outputDirectory || resolve(process.cwd(), 'dist');
            const index = resolve(dist, 'index.html');
            writeFileSync(index, readFileSync(index, 'utf8').replace(/\r+\n/g, '\n'));
            copyFileSync(index, resolve(dist, '404.html'));
        }
    };
};

const brandFontLicensesPlugin = () => {
    let sourceRoot;
    return {
        name: 'brand-font-licenses',
        configResolved(config) { sourceRoot = config.root; },
        generateBundle() {
            const licenses = ['Tajawal', 'Cairo'].map(family =>
                `${family}\n${readFileSync(resolve(sourceRoot, `src/assets/brand/OFL-${family}.txt`), 'utf8')}`
            ).join('\n\n');
            this.emitFile({ type: 'asset', fileName: 'assets/brand-font-licenses.txt', source: licenses });
        }
    };
};

const releaseRevisionPlugin = () => ({
    name: 'remal-release-revision',
    transformIndexHtml() {
        const revision = process.env.RENDER_GIT_COMMIT || process.env.REMAL_UX_REVISION || '';
        return /^[a-f\d]{40}$/i.test(revision)
            ? [{ tag: 'meta', attrs: { name: 'remal-revision', content: revision }, injectTo: 'head' }]
            : [];
    }
});

export default defineConfig(({ mode }) => {
    return {
        base: '/',
        envDir: '..',
        plugins: [react(), brandFontLicensesPlugin(), releaseRevisionPlugin(), githubPagesFallbackPlugin()],
        server: {
            port: 5173,
            proxy: {
                '/api': {
                    target: 'http://localhost:10000',
                    changeOrigin: true,
                    secure: false
                }
            }
        }
    };
});
