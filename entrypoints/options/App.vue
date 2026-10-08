<template>
  <div class="min-h-screen bg-background text-foreground">
    <!-- Main container -->
    <div class="flex flex-col md:flex-row h-screen">
      <!-- Left navigation bar -->
      <OptionsNavigation
        :current-section="currentSection"
        @section-change="handleSectionChange"
      />

      <!-- Right content area -->
      <div class="flex-1 flex flex-col">
        <!-- Top status bar -->
        <div
          class="h-16 bg-card border-b border-border flex items-center justify-between px-4 md:px-6"
          :class="{ 'mobile-header': isMobile }"
        >
          <div class="flex items-center space-x-4">
            <h1 class="text-xl font-semibold" :class="{ 'ml-12': isMobile }">
              {{ getSectionTitle(currentSection) }}
            </h1>
          </div>
          <div class="flex items-center space-x-4">
            <!-- Save status indicator -->
            <div
              v-if="saveMessage"
              class="hidden md:block text-sm text-muted-foreground"
            >
              {{ saveMessage }}
            </div>
            <!-- Theme toggle button -->
            <button
              @click="toggleTheme"
              class="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
              :title="$t('options.toggleTheme')"
            >
              <component :is="isDark ? Sun : Moon" class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- Mobile save status notice -->
        <div
          v-if="saveMessage && isMobile"
          class="fixed bottom-4 left-1/2 transform -translate-x-1/2 px-4 py-2 bg-primary text-primary-foreground rounded-md shadow-lg z-50"
        >
          {{ saveMessage }}
        </div>

        <!-- Main content area -->
        <OptionsContent
          :current-section="currentSection"
          @save-message="handleSaveMessage"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { Sun, Moon } from 'lucide-vue-next';
import OptionsNavigation from './components/OptionsNavigation.vue';
import OptionsContent from './components/OptionsContent.vue';

const { t } = useI18n();

// Currently selected settings section
const currentSection = ref('basic');

// Save status message
const saveMessage = ref('');

// Theme state
const isDark = ref(false);

// Mobile state
const isMobile = ref(false);

// Settings section title map
const sectionTitles: Record<string, string> = {
  basic: t('options.basic'),
  translation: t('options.translation'),
  'website-management': t('options.websiteManagement'),
  floating: t('options.floating'),
  hotkey: t('options.hotkey'),
  data: t('options.data'),
  about: t('options.about'),
};

// Check whether the device is mobile
const checkIfMobile = () => {
  isMobile.value = window.innerWidth < 768;
};

onMounted(async () => {
  // Prefer loading the theme setting from storage
  const storedTheme = await browser.storage.local.get('theme');
  if (storedTheme.theme) {
    isDark.value = storedTheme.theme === 'dark';
  } else {
    // If none in storage, fall back to the system preference
    isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  applyTheme();

  // Check the anchor parameter in the URL
  const hash = window.location.hash.substring(1);
  if (hash && sectionTitles[hash]) {
    currentSection.value = hash;
  }

  // Listen for browser back/forward buttons
  window.addEventListener('hashchange', handleHashChange);

  // Initial device type detection
  checkIfMobile();
  window.addEventListener('resize', checkIfMobile);
});

// Remove event listeners
onUnmounted(() => {
  window.removeEventListener('hashchange', handleHashChange);
  window.removeEventListener('resize', checkIfMobile);
});

// Watch currentSection changes and update the URL anchor
watch(currentSection, (newSection) => {
  if (window.location.hash.substring(1) !== newSection) {
    window.history.pushState(null, '', `#${newSection}`);
  }
});

const handleHashChange = () => {
  const hash = window.location.hash.substring(1);
  if (hash && sectionTitles[hash]) {
    currentSection.value = hash;
  }
};

const handleSectionChange = (section: string) => {
  currentSection.value = section;

  // Scroll to the matching anchor after a short delay to ensure content has rendered
  setTimeout(() => {
    const element = document.getElementById(section);
    if (element) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }
  }, 100);
};

const handleSaveMessage = (message: string) => {
  saveMessage.value = message;
  setTimeout(() => {
    saveMessage.value = '';
  }, 3000);
};

const getSectionTitle = (section: string): string => {
  return sectionTitles[section] || t('options.settings');
};

const toggleTheme = async () => {
  isDark.value = !isDark.value;
  applyTheme();
  // Save the theme preference to storage
  await browser.storage.local.set({ theme: isDark.value ? 'dark' : 'light' });
};

const applyTheme = () => {
  const html = document.documentElement;
  if (isDark.value) {
    html.classList.add('dark');
  } else {
    html.classList.remove('dark');
  }
};
</script>

<style scoped>
/* Mobile title styles */
.mobile-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 30;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

@media (max-width: 767px) {
  .min-h-screen {
    height: 100vh;
    width: 100vw;
    overflow-x: hidden;
  }
}
</style>
