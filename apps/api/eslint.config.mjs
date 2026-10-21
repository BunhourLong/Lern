import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist', '*.js', '*.mjs'] },
  js.configs.recommended,
  // Type-aware rules catch un-awaited promises (lost errors in tx/handler code)
  tseslint.configs.recommendedTypeChecked,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } },
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['picomatch', 'micromatch', 'tinyglobby'].map((name) => ({
            name,
            message: 'picomatch has an open ReDoS ignored in apps/api/.snyk; never build globs from request data.',
          })),
        },
      ],
    },
  },
);
