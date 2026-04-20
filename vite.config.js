import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    root: '.',
    publicDir: 'public',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                chatwindow: resolve(__dirname, 'chatwindow.html'),
                gcalDemo: resolve(__dirname, 'demo/google-calendar/index.html'),
                gcalCallback: resolve(__dirname, 'api/google-calendar/callback/index.html')
            }
        },
        // Keep readable for now — enable minification when tests are stable
        minify: 'esbuild',
        sourcemap: true
    },
    server: {
        port: 3000,
        open: true
    }
});
