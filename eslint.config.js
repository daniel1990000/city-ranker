// Lint for the bugs types can't catch: promises nobody waits for (an async failure that vanishes, or code that
// runs before it should) and switches that miss a case. Style is left to the existing code conventions.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist*/**', 'android/**', 'ios/**', 'node_modules/**', 'scripts/**', 'public/**', 'tests/**', '*.config.*'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
    },
  },
);
