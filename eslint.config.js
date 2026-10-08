import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import { defineConfig } from 'eslint/config';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default defineConfig([
  {
    ignores: ['**/.wxt/**', '**/.output/**'], // Ignore all .wxt files
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,vue}'],
    plugins: { js },
    extends: ['js/recommended'],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,vue}'],
    languageOptions: { globals: globals.browser },
  },
  tseslint.configs.recommended,
  pluginVue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    rules: {
      // Common rules that support --fix
      semi: ['error', 'always'], // Require semicolons
      quotes: ['error', 'single'], // Require single quotes
      indent: ['error', 2], // 2-space indentation
      'comma-dangle': ['error', 'always-multiline'], // Require trailing commas in multiline objects/arrays
      'no-trailing-spaces': 'error', // Remove trailing spaces
      'eol-last': ['error', 'always'], // Require newline at end of file
      'no-multiple-empty-lines': ['error', { max: 1 }], // Limit consecutive blank lines
      'object-curly-spacing': ['error', 'always'], // Spaces inside object braces
      'array-bracket-spacing': ['error', 'never'], // No spaces inside array brackets
      'no-unused-vars': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'none',
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-undef': 'off',
      'vue/multi-word-component-names': 'off',
      'no-case-declarations': 'off',
      'no-useless-escape': 'off',
    },
  },
  {
    plugins: { prettier: prettierPlugin },
    extends: [prettierConfig],
    rules: {
      'prettier/prettier': 'error',
    },
  },
]);
