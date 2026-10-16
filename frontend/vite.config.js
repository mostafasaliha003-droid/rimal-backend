import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const githubPagesFallbackPlugin = () => ({
    name: 'github-pages-fallback',
    apply: 'build',
    writeBundle(outputOptions) {
        const dist = resolve(outputOptions.dir || 'dist');
        const index = resolve(dist, 'index.html');
        writeFileSync(index, readFileSync(index, 'utf8').replace(/\r+\n/g, '\n'));
        copyFileSync(index, resolve(dist, '404.html'));
    }
});

function configuredBuildOutput(env) {
    const configured = env.REMAL_VITE_OUT_DIR;
    return configured ? resolve(configured) : 'dist';
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '..', '');

    return {
        base: '/',
        envDir: '..',
        plugins: [react(), {
            name: 'remal-release-revision',
            transformIndexHtml() {
                const revision = process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || '';
                return /^[a-f\d]{40}$/i.test(revision)
                    ? [{ tag: 'meta', attrs: { name: 'remal-revision', content: revision }, injectTo: 'head' }]
                    : [];
            }
        }, githubPagesFallbackPlugin()],
        build: { outDir: configuredBuildOutput(env) },
        server: {
            port: 5173,
            proxy: {
                '/api': {
                    target: 'http://localhost:10000',
                    changeOrigin: true,
                    secure: false,
                    headers: env.REMAL_SECURE_KEY ? { 'x-api-key': env.REMAL_SECURE_KEY } : {}
                }
            }
        }
    };
});
