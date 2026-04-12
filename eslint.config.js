export default [
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly',
                fetch: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
                navigator: 'readonly',
                location: 'readonly',
                alert: 'readonly',
                confirm: 'readonly',
                URLSearchParams: 'readonly',
                FormData: 'readonly',
                Blob: 'readonly',
                File: 'readonly',
                FileReader: 'readonly',
                URL: 'readonly',
                Date: 'readonly',
                JSON: 'readonly',
                Array: 'readonly',
                Object: 'readonly',
                String: 'readonly',
                Number: 'readonly',
                Promise: 'readonly',
                Map: 'readonly',
                Set: 'readonly',
                Sentry: 'readonly',
                posthog: 'readonly',
                supabase: 'readonly',
                XLSX: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-console': 'off',
            'no-undef': 'error',
            'eqeqeq': ['warn', 'always'],
            'no-var': 'warn',
            'prefer-const': 'warn'
        }
    },
    {
        ignores: ['dist/', 'node_modules/', '*.min.js']
    }
];
