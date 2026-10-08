import { ContentManager } from '@/src/modules/content/ContentManager';

/**
 * Content Script entry point
 * Initialized and managed through the service-oriented architecture
 */
export default defineContentScript({
  // Match all websites
  matches: ['<all_urls>'],

  // Main function
  async main() {
    const contentManager = new ContentManager();

    try {
      await contentManager.init();
    } catch (error) {
      console.error('[Content Script] Initialization failed:', error);
      // Clean up resources
      contentManager.destroy();
    }

    // Clean up resources on page unload
    window.addEventListener('beforeunload', () => {
      contentManager.destroy();
    });
  },
});
