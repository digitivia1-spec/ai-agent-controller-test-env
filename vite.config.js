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
                chatwindow: resolve(__dirname, 'chatwindow.html')
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
