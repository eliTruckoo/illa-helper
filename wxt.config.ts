import { defineConfig } from 'wxt';
import removeConsole from 'vite-plugin-remove-console';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite';

// Read the version from package.json
const packageJson = JSON.parse(
  readFileSync(resolve('./package.json'), 'utf-8'),
);
const version = packageJson.version;

// Firefox-only settings. AMO needs a stable add-on ID, and new add-ons must
// declare data collection for Firefox's built-in consent prompt (Firefox 140+).
// Page text goes to the user's configured AI provider, hence websiteContent.
const gecko = {
  id: 'elilla-assistant@elias-nzirorera',
  strict_min_version: '140.0',
  data_collection_permissions: {
    required: ['websiteContent'],
  },
};

// Firefox for Android supports data_collection_permissions only from 142
const geckoAndroid = {
  strict_min_version: '142.0',
};

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  hooks: {
    // Ship the MIT license inside every package, as the license requires
    'build:publicAssets': (_wxt, files) => {
      files.push({ absoluteSrc: resolve('LICENSE'), relativeDest: 'LICENSE' });
    },
  },
  manifest: ({ browser }) => ({
    name: 'Elilla Assistant',
    // Store policies: say what it does to pages and that it needs a paid-for key
    description:
      'Learn a language as you browse: swaps some words on a page for translations at your level. Needs your own AI API key (may be paid).',
    ...(browser === 'firefox' && {
      browser_specific_settings: { gecko, gecko_android: geckoAndroid },
    }),
    version,
    permissions: [
      'storage',
      'notifications',
      'contextMenus',
      'activeTab',
      'webNavigation',
      'alarms',
    ],
    // GitHub is only for the update check, which Firefox builds don't run
    host_permissions:
      browser === 'firefox'
        ? ['<all_urls>']
        : ['<all_urls>', 'https://api.github.com/*'],
    commands: {
      'translate-page': {
        suggested_key: {
          default: 'Alt+Z',
          mac: 'Command+Z',
        },
        description: 'Translate with one click',
      },
    },
  }),
  zip: {
    // README screenshots aren't needed to rebuild the extension from sources
    excludeSources: ['images/**'],
  },
  imports: {
    eslintrc: {
      enabled: 9,
    },
  },
  vite: (configEnv) => ({
    plugins: [
      tailwindcss(),
      VueI18nPlugin({
        // Automatically load language pack files
        include: [
          resolve(
            dirname(fileURLToPath(import.meta.url)),
            './src/i18n/locales/**',
          ),
        ],
        // Supports JSON and YAML formats
        forceStringify: true,
        // Enable runtime optimization
        runtimeOnly: false,
        // Automatically generate type definitions
        compositionOnly: true,
        // Supports nested structures
        fullInstall: true,
      }),
      configEnv.mode === 'production'
        ? [removeConsole({ includes: ['log', 'warn'] })]
        : [],
    ],
  }),
});
