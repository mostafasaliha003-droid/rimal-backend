import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '..', '');

    return {
        envDir: '..',
        plugins: [react()],
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
