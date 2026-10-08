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

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Immersive Language Learning Assistant (illa-helper)',
    author: {
      email: 'xiao1932794922@gmail.com',
    },
    description: `Immersive Language Learning Assistant (illa-helper) extension turns browsing into language learning. AI uses "i+1" theory, supports 20+ languages.`,
    version,
    permissions: [
      'storage',
      'notifications',
      'contextMenus',
      'activeTab',
      'webNavigation',
      'alarms',
    ],
    host_permissions: ['<all_urls>', 'https://api.github.com/*'],
    commands: {
      'translate-page': {
        suggested_key: {
          default: 'Alt+Z',
          mac: 'Command+Z',
        },
        description: 'Translate with one click',
      },
    },
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
