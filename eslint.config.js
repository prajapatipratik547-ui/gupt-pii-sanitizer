import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // innerHTML is banned in app code: every piece of user text goes through textContent.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Use textContent / DOM nodes so user text can never become markup.' },
        { property: 'outerHTML', message: 'Use DOM nodes instead.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'No HTML string injection.' },
        { selector: "CallExpression[callee.name='fetch']", message: 'Gupt must never make network requests.' },
        { selector: "NewExpression[callee.name='XMLHttpRequest']", message: 'Gupt must never make network requests.' },
        { selector: "NewExpression[callee.name='WebSocket']", message: 'Gupt must never make network requests.' },
      ],
    },
  },
);
