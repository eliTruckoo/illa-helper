<script lang="ts" setup>
import { ref, onMounted, onUnmounted, watch, reactive, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEFAULT_SETTINGS,
  UserSettings,
  DEFAULT_MULTILINGUAL_CONFIG,
  DEFAULT_PRONUNCIATION_HOTKEY,
  DEFAULT_FLOATING_BALL_CONFIG,
} from '@/src/modules/shared/types';
import { StorageService } from '@/src/modules/core/storage';
import { messagingService } from '@/src/modules/core/messaging';
import { Ban as BanIcon } from 'lucide-vue-next';
import {
  WebsiteManager,
  WebsiteStatus,
} from '@/src/modules/options/website-management';
import {
  extractDomain,
  generateDomainPattern,
  generateRuleDescription,
  validateUrlForRule,
} from '@/src/modules/options/website-management/utils';
import { createDebouncedTask } from '@/src/utils/debounce';

// Use i18n
const { t } = useI18n();

// Service instances
const storageService = StorageService.getInstance();

const settings = ref<UserSettings>({ ...DEFAULT_SETTINGS });
const hasUpdate = ref(false);

onMounted(async () => {
  const loadedSettings = await storageService.getUserSettings();

  // Ensure all config items exist
  if (!loadedSettings.multilingualConfig) {
    loadedSettings.multilingualConfig = { ...DEFAULT_MULTILINGUAL_CONFIG };
  }
  if (!loadedSettings.pronunciationHotkey) {
    loadedSettings.pronunciationHotkey = { ...DEFAULT_PRONUNCIATION_HOTKEY };
  }
  if (!loadedSettings.floatingBall) {
    loadedSettings.floatingBall = { ...DEFAULT_FLOATING_BALL_CONFIG };
  }

  // Mark initialization complete after settings.value is set
  settings.value = reactive(loadedSettings);

  // Defer marking initialization complete so all reactive updates finish
  nextTick(() => {
    isInitializing = false;
  });

  try {
    const manifest = browser.runtime.getManifest();
    extensionVersion.value = manifest.version;
  } catch (error) {
    console.error(t('errors.getExtensionVersion'), error);
    // This may fail outside the extension environment or in the dev server. A default value can be set.
    extensionVersion.value = 'DEV';
  }

  await loadCurrentSite();

  // Check for updates
  await checkForUpdates();
});

// Current site rule state
const websiteManager = new WebsiteManager();
const currentTab = ref<{ id?: number; url?: string } | null>(null);
const currentDomain = ref('');
const currentSiteStatus = ref<WebsiteStatus>('normal');
const canManageCurrentSite = ref(false);
const isUpdatingSiteRule = ref(false);

const loadCurrentSite = async () => {
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url || !validateUrlForRule(tab.url).valid) return;

    currentTab.value = { id: tab.id, url: tab.url };
    currentDomain.value = extractDomain(tab.url).replace(/^www\./, '');
    currentSiteStatus.value = await websiteManager.getWebsiteStatus(tab.url);
    canManageCurrentSite.value = true;
  } catch (error) {
    console.error('Failed to load current site status', error);
  }
};

const disableCurrentSite = async () => {
  const tab = currentTab.value;
  if (!tab?.url || isUpdatingSiteRule.value) return;

  isUpdatingSiteRule.value = true;
  try {
    const pattern = generateDomainPattern(extractDomain(tab.url));
    await websiteManager.addRule(
      pattern,
      'blacklist',
      generateRuleDescription(pattern, 'blacklist'),
    );
    currentSiteStatus.value = 'blacklisted';
    // Content scripts only check site rules on load, so reload to drop translations
    if (tab.id) {
      await browser.tabs.reload(tab.id);
    }
  } catch (error) {
    console.error(t('errors.saveRuleFailed'), error);
    showSavedMessage(t('settings.saveFailed'));
  } finally {
    isUpdatingSiteRule.value = false;
  }
};

const openWebsiteManagement = () => {
  browser.tabs.create({ url: 'options.html#website-management' });
};

// Settings update state management
let isInitializing = true;
const saveTask = createDebouncedTask(() => saveAndNotifySettings(), 200);

// Unified settings update watcher
watch(
  settings,
  () => {
    // Skip triggers during the initialization phase
    if (isInitializing) return;

    saveTask.schedule();
  },
  { deep: true },
);

// Closing the popup must not drop a pending save
const flushPendingSave = () => saveTask.flush();
window.addEventListener('pagehide', flushPendingSave);
onUnmounted(() => {
  window.removeEventListener('pagehide', flushPendingSave);
  flushPendingSave();
});

// Unified save and notify function
const saveAndNotifySettings = async () => {
  try {
    // Simplified validation: ensure language settings are complete
    if (
      !settings.value.multilingualConfig.targetLanguage.trim() ||
      !settings.value.multilingualConfig.nativeLanguage.trim()
    ) {
      showSavedMessage(t('settings.selectLanguageFirst'));
      return;
    }

    await storageService.saveUserSettings(settings.value);
    await messagingService.notifySettingsChanged(settings.value);
    showSavedMessage(t('settings.save'));
  } catch (error) {
    console.error(t('settings.saveFailed'), error);
    showSavedMessage(t('settings.saveFailed'));
  }
};

const saveMessage = ref('');
const showSavedMessage = (message: string) => {
  saveMessage.value = message;
  setTimeout(() => (saveMessage.value = ''), 2000);
};

const handleTranslate = async () => {
  try {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tabs[0]?.id) {
      await browser.tabs.sendMessage(tabs[0].id, {
        type: 'translate-page-command',
      });
    }
  } catch (error) {
    console.error(t('errors.manualTranslateFailed'), error);
  }
};

const openAdvancedSettings = () => {
  const url = browser.runtime.getURL('/options.html#about');
  window.open(url);
};

async function checkForUpdates() {
  try {
    // Get stored update info
    const updateInfo = await browser.runtime.sendMessage({
      type: 'GET_UPDATE_INFO',
    });
    if (updateInfo && updateInfo.hasUpdate) {
      hasUpdate.value = true;
    }
  } catch (error) {
    console.error(t('errors.checkUpdateFailed'), error);
  }
}

const extensionVersion = ref('N/A');
</script>

<template>
  <div class="container">
    <header>
      <div class="header-content">
        <div class="logo">
          <img
            src="/assets/vue.svg"
            alt="logo"
            style="width: 40px; height: 40px"
          />
        </div>
        <div class="title-container">
          <h1>{{ $t('app.title') }}</h1>
        </div>
      </div>
      <div class="header-actions">
        <button
          @click="handleTranslate"
          class="manual-translate-btn"
          :title="$t('actions.translate')"
        >
          {{ $t('actions.translate') }}
        </button>
      </div>
    </header>

    <div class="settings">
      <div class="main-layout">
        <div class="settings-card">
          <div class="site-control">
            <template v-if="!canManageCurrentSite">
              <p class="site-control-note">{{ $t('site.unavailable') }}</p>
            </template>
            <template v-else-if="currentSiteStatus === 'blacklisted'">
              <p class="site-control-note">
                {{ $t('site.disabled', { domain: currentDomain }) }}
              </p>
              <button @click="openWebsiteManagement" class="tip-link-btn">
                {{ $t('site.manage') }}
              </button>
            </template>
            <button
              v-else
              @click="disableCurrentSite"
              :disabled="isUpdatingSiteRule"
              class="site-disable-btn"
              :title="currentDomain"
            >
              <BanIcon class="w-4 h-4" />
              <span>{{ $t('site.disable') }}</span>
            </button>
          </div>

          <div class="adaptive-settings-grid">
            <div class="setting-group full-width">
              <label>
                {{ $t('replacement.maxLength') }}: {{ settings.maxLength }}
              </label>
              <input
                type="range"
                v-model.number="settings.maxLength"
                min="10"
                max="2000"
                step="10"
              />
            </div>
          </div>

          <!-- Lazy loading settings -->
          <div class="topping-settings-card mt-3">
            <div class="setting-group">
              <label>{{ $t('lazyLoading.title') }}</label>
              <div class="toggle-container">
                <input
                  type="checkbox"
                  v-model="settings.lazyLoading.enabled"
                  id="lazy-loading-toggle"
                  class="toggle-input"
                />
                <label for="lazy-loading-toggle" class="toggle-label">
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
            <!-- Preload distance adjustment -->
            <div v-if="settings.lazyLoading.enabled" class="setting-group">
              <label>
                {{ $t('lazyLoading.preloadDistance') }}:
                {{ Math.round(settings.lazyLoading.preloadDistance * 100) }}%
              </label>
              <input
                type="range"
                v-model.number="settings.lazyLoading.preloadDistance"
                min="0.0"
                max="2.0"
                step="0.1"
              />
              <p class="setting-note" style="margin-top: 2px; font-size: 11px">
                {{ $t('lazyLoading.note') }}
              </p>
            </div>
          </div>
        </div>
      </div>
      <div class="save-message-container">
        <span class="save-message" v-if="saveMessage">{{ saveMessage }}</span>
      </div>
    </div>

    <footer>
      <div class="footer-row floating-footer">
        <div class="footer-row-left flex flex-col items-center">
          <p>
            <span
              class="text-gray-500 cursor-pointer hover:text-blue-500 transition-colors"
              @click="hasUpdate ? openAdvancedSettings() : undefined"
              :title="hasUpdate ? $t('footer.clickForUpdate') : ''"
              style="white-space: nowrap"
            >
              v{{ extensionVersion }}
              <span
                v-if="hasUpdate"
                class="bg-red-500 text-white rounded font-bold animate-pulse"
                style="
                  font-size: 8px;
                  line-height: 1;
                  margin-left: 2px;
                  padding: 1px 3px;
                  display: inline-block;
                "
              >
                {{ $t('common.new') }}
              </span>
            </span>
          </p>
        </div>
        <button
          class="footer-settings-btn"
          @click="openAdvancedSettings"
          :title="$t('footer.settings')"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 15a3 3 0 100-6 3 3 0 000 6z"
              stroke="currentColor"
              stroke-width="2"
            />
            <path
              d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"
              stroke="currentColor"
              stroke-width="2"
            />
          </svg>
          <span class="footer-settings-text">{{ $t('footer.settings') }}</span>
        </button>
      </div>
    </footer>
  </div>
</template>
<style scoped>
:root {
  color-scheme: light dark;
}

.container {
  --bg-color: #f0f4f8;
  --card-bg-color: #ffffff;
  --primary-color: #6a88e0;
  --primary-hover-color: #5a78d0;
  --text-color: #37474f;
  --label-color: #546e7a;
  --border-color: #e0e6ed;
  --success-color: #4caf50;
  --input-bg-color: #fdfdff;
  --input-text-color: #37474f;
  --select-option-text-color: #000;
  --select-option-bg-color: #fff;

  width: 360px;
  padding: 5px;
  font-family: 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
  background-color: var(--bg-color);
  color: var(--text-color);
  position: relative;
  padding-bottom: 56px;
  /* Reserve footer height to avoid content being covered */
}

@media (prefers-color-scheme: dark) {
  .container {
    --bg-color: #1e1e1e;
    --card-bg-color: #252526;
    --primary-color: #646cff;
    --primary-hover-color: #535bf2;
    --text-color: rgba(255, 255, 255, 0.87);
    --label-color: rgba(255, 255, 255, 0.7);
    --border-color: #3c3c3c;
    --input-bg-color: #3c3c3c;
    --input-text-color: rgba(255, 255, 255, 0.87);
    --select-option-text-color: #fff;
    --select-option-bg-color: #3c3c3c;
  }

  .toggle-slider {
    background-color: #f0f0f0 !important;
  }

  .toggle-label:hover {
    background-color: rgba(100, 108, 255, 0.2) !important;
  }

  .settings-card {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2) !important;
  }

  .settings-card:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
  }
}

header {
  text-align: center;
  margin-bottom: 16px;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.logo {
  flex-shrink: 0;
}

.title-container h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--primary-color);
}

.title-container p {
  margin: 4px 0 0 0;
  font-size: 12px;
  color: var(--label-color);
}

.setting-box {
  position: relative;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-btn {
  background: var(--border-color);
  color: var(--label-color);
  border: none;
  border-radius: 6px;
  padding: 6px;
  cursor: pointer;
  transition:
    background-color 0.2s,
    transform 0.1s,
    color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
}

.settings-btn:hover {
  background: var(--primary-color);
  color: white;
  transform: translateY(-1px);
}

.settings-btn:active {
  transform: translateY(0);
}

.manual-translate-btn {
  position: absolute;
  top: 15px;
  right: 15px;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.manual-translate-btn:hover {
  background: var(--primary-hover-color);
}

.advanced-settings-btn {
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s;
  width: 100%;
  box-sizing: border-box;
}

.advanced-settings-btn:hover {
  background: var(--primary-hover-color);
}

.settings {
  margin-bottom: 16px;
}

.main-layout {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-card {
  background: var(--card-bg-color);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  transition: box-shadow 0.2s ease;
  box-sizing: border-box;
  width: 100%;
}

.settings-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.adaptive-settings-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  width: 100%;
  box-sizing: border-box;
}

.adaptive-settings-grid .setting-group {
  flex: 1 1 calc(50% - 6px);
  min-width: 140px;
}

.adaptive-settings-grid .setting-group.target-language-group {
  flex: 1 1 calc(50% - 6px);
  min-width: 140px;
}

.setting-group.full-width {
  grid-column: 1 / -1;
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.topping-settings-card {
  background-color: var(--card-bg-color);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  transition: box-shadow 0.2s ease;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toggle-container {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
}

.toggle-input {
  display: none;
}

.toggle-label {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  background-color: var(--border-color);
  border-radius: 12px;
  cursor: pointer;
  transition: background-color 0.3s ease;
}

.toggle-label:hover {
  background-color: rgba(106, 136, 224, 0.2);
}

.toggle-slider {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  background-color: white;
  border-radius: 50%;
  transition:
    transform 0.3s ease,
    box-shadow 0.3s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.toggle-input:checked + .toggle-label {
  background-color: var(--primary-color);
}

.toggle-input:checked + .toggle-label .toggle-slider {
  transform: translateX(20px);
  box-shadow: 0 2px 6px rgba(106, 136, 224, 0.4);
}

.toggle-input:focus + .toggle-label {
  box-shadow: 0 0 0 2px rgba(106, 136, 224, 0.3);
}

.setting-group label {
  font-size: 14px;
  font-weight: 500;
  color: var(--label-color);
}

.setting-group input,
.setting-group input:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px rgba(106, 136, 224, 0.2);
}

.setting-group input[type='range'] {
  padding: 0;
  height: 6px;
  background: var(--border-color);
  border-radius: 3px;
  appearance: none;
  cursor: pointer;
}

.setting-group input[type='range']::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  background: var(--primary-color);
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.1s;
}

.setting-group input[type='range']::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.setting-note {
  font-size: 12px;
  color: var(--label-color);
  margin: 4px 0 0 0;
  font-style: italic;
}

.save-message-container {
  height: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.save-message {
  color: var(--success-color);
  font-size: 12px;
  font-weight: 500;
}

footer p {
  margin: 0;
  font-size: 12px;
  color: var(--label-color);
}

/* Target language selector animation */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}

.slide-down-enter-from {
  opacity: 0;
  max-height: 0;
  transform: translateY(-10px);
}

.slide-down-enter-to {
  opacity: 1;
  max-height: 200px;
  transform: translateY(0);
}

.slide-down-leave-from {
  opacity: 1;
  max-height: 200px;
  transform: translateY(0);
}

.slide-down-leave-to {
  opacity: 0;
  max-height: 0;
  transform: translateY(-10px);
}

.footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}

.footer-settings-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--border-color);
  color: var(--label-color);
  border: none;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 13px;
  cursor: pointer;
  transition:
    background 0.2s,
    color 0.2s;
}

.footer-settings-btn:hover {
  background: var(--primary-color);
  color: #fff;
}

.footer-settings-text {
  margin-left: 2px;
}

.floating-footer {
  position: fixed;
  left: 0;
  bottom: 0;
  width: 100%;
  background: rgba(240, 244, 248, 0.85);
  border-top: 1px solid var(--border-color);
  z-index: 100;
  box-sizing: border-box;
  padding: 14px 14px 10px 14px;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: 5px 5px 0 0;
  box-shadow: 0 -2px 16px rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(8px);
  overflow: visible;
}

.floating-footer::before {
  content: '';
  position: absolute;
  top: -8px;
  left: 0;
  width: 100%;
  height: 16px;
  pointer-events: none;
  background: linear-gradient(
    to bottom,
    rgba(240, 244, 248, 0.7) 0%,
    rgba(240, 244, 248, 0) 100%
  );
  border-radius: 8px 8px 0 0;
  z-index: -1;
}

@media (prefers-color-scheme: dark) {
  .floating-footer {
    background: rgba(30, 30, 30, 0.85);
    border-top: 1px solid #333;
    box-shadow: 0 -2px 24px rgba(0, 0, 0, 0.18);
  }

  .floating-footer::before {
    background: linear-gradient(
      to bottom,
      rgba(30, 30, 30, 0.7) 0%,
      rgba(30, 30, 30, 0) 100%
    );
  }
}

/* Current site control */
.site-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.site-control .tip-link-btn {
  white-space: nowrap;
}

.site-control-note {
  margin: 0;
  font-size: 12px;
  color: var(--label-color);
  overflow-wrap: anywhere;
}

.site-disable-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
  background: var(--input-bg-color);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  transition:
    border-color 0.2s,
    color 0.2s;
}

.site-disable-btn:not(:disabled):hover {
  color: #e53935;
  border-color: #e53935;
}

.site-disable-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.tip-link-btn {
  background: none;
  border: none;
  color: var(--primary-color);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  padding: 0;
  text-decoration: underline;
  transition: color 0.2s;
}

.tip-link-btn:hover {
  color: var(--primary-hover-color);
}

/* Native language setting styles */
.native-language-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.native-language-group .setting-group {
  flex: 1 1 calc(50% - 6px);
  min-width: 140px;
}

.native-language-group .setting-group.target-language-group {
  flex: 1 1 calc(50% - 6px);
  min-width: 140px;
}

.switch-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 12px;
}

.switch-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--label-color);
  cursor: pointer;
}

.switch-checkbox {
  display: none;
}

.switch-slider {
  position: relative;
  width: 40px;
  height: 20px;
  background-color: var(--border-color);
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.3s ease;
}

.switch-slider::before {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  background-color: white;
  border-radius: 50%;
  top: 2px;
  left: 2px;
  transition: transform 0.3s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.switch-checkbox:checked + .switch-slider {
  background-color: var(--primary-color);
}

.switch-checkbox:checked + .switch-slider::before {
  transform: translateX(20px);
}

.switch-description {
  font-size: 11px;
  color: var(--label-color);
  margin-top: 4px;
}

/* Simplified hint styles */
.simple-explanation {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 12px;
  color: #6c757d;
  margin-top: 8px;
  line-height: 1.4;
}
</style>
