import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
                Atomics: 'readonly',
                SharedArrayBuffer: 'readonly',
            },
        },
        rules: {
            'indent': ['error', 2],
            'quotes': ['error', 'single'],
            'semi': ['error', 'always'],
            'no-unused-vars': [
                'warn',
                {
                    'args': 'none',
                },
            ],
            'no-console': 'off',
            'no-debugger': 'warn',
            'no-unused-expressions': 'error',
            'no-trailing-spaces': 'error',
            'no-undef': 'error',
        },
    },
];
