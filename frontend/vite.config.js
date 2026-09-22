import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const githubPagesFallbackPlugin = () => ({
    name: 'github-pages-fallback',
    closeBundle() {
        const dist = resolve(process.cwd(), 'dist');
        const index = resolve(dist, 'index.html');
        writeFileSync(index, readFileSync(index, 'utf8').replace(/\r+\n/g, '\n'));
        copyFileSync(index, resolve(dist, '404.html'));
    }
});

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '..', '');

    return {
        base: '/',
        envDir: '..',
        plugins: [react(), githubPagesFallbackPlugin()],
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
