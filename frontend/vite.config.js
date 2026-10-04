import { defineConfig } from 'vite';
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

export default defineConfig(() => ({
        base: '/',
        envDir: '..',
        plugins: [react(), githubPagesFallbackPlugin()],
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
    }));
