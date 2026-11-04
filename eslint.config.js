import tseslint from 'typescript-eslint';

// Rule 3 of the plan: the engine is pure TypeScript. It must never import three, react or the DOM,
// so the same code drives the live demo and the Node batch runner.
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'results'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/engine/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['three', 'three/*', '@react-three/*', 'react', 'react-dom', 'react/*', 'zustand', 'zustand/*'], message: 'src/engine must stay pure TS (no three/react/DOM).' },
          { group: ['**/app/**', '../app/*', '../../app/*'], message: 'src/engine must not import the front end.' },
        ],
      }],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'requestAnimationFrame', 'localStorage', 'performance'],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
