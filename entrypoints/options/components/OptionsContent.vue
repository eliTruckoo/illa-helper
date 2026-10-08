<template>
  <div class="flex-1 overflow-y-auto bg-background">
    <!-- Content area -->
    <div :class="['p-4 md:p-6', { 'pt-20': isMobile }]">
      <div class="max-w-4xl mx-auto">
        <Transition name="fade" mode="out-in">
          <div
            v-if="currentSection"
            :id="currentSection"
            class="anchor-section"
          >
            <component
              :is="currentComponent"
              :key="currentSection"
              @save-message="handleSaveMessage"
            />
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import WebsiteManagement from './website-management/WebsiteManagement.vue';
import BasicSettings from './basic/BasicSettings.vue';
import TranslationSettings from './translation/TranslationSettings.vue';
import AppearanceSettings from './appearance/AppearanceSettings.vue';
import DataManagement from './data/DataManagement.vue';
import About from './about/About.vue';
import HotkeySettings from './basic/HotkeySettings.vue';

interface Props {
  currentSection: string;
}

const props = defineProps<Props>();
const isMobile = ref(false);

const emit = defineEmits<{
  saveMessage: [message: string];
}>();

// Component map
const componentMap: Record<string, any> = {
  basic: BasicSettings,
  translation: TranslationSettings,
  'website-management': WebsiteManagement,
  floating: AppearanceSettings,
  hotkey: HotkeySettings,
  about: About,
  data: DataManagement,
};

const currentComponent = computed(() => {
  return componentMap[props.currentSection] || WebsiteManagement;
});

const handleSaveMessage = (message: string) => {
  emit('saveMessage', message);
};

// Check whether the device is mobile
const checkIfMobile = () => {
  isMobile.value = window.innerWidth < 768;
};

onMounted(() => {
  checkIfMobile();
  window.addEventListener('resize', checkIfMobile);
});

onUnmounted(() => {
  window.removeEventListener('resize', checkIfMobile);
});
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.anchor-section {
  scroll-margin-top: 80px;
  /* Account for top navigation bar height */
}

/* Mobile adaptation styles */
@media (max-width: 767px) {
  .anchor-section {
    scroll-margin-top: 60px;
  }
}
</style>
