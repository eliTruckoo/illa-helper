import { ContentManager } from '@/src/modules/content/ContentManager';

/**
 * Content Script entry point
 * Initialized and managed through the service-oriented architecture
 */
export default defineContentScript({
  // Match all websites
  matches: ['<all_urls>'],

  // Main function
  async main(ctx) {
    const contentManager = new ContentManager();

    // Tear down observers, listeners, timers and UI when the extension is
    // reloaded/updated/uninstalled, so orphaned scripts stop working on the page.
    // No beforeunload/unload handler: it would block the back/forward cache,
    // and a normally unloading page frees everything anyway.
    ctx.onInvalidated(() => {
      contentManager.destroy();
    });

    try {
      await contentManager.init();
    } catch (error) {
      console.error('[Content Script] Initialization failed:', error);
      // Clean up resources
      contentManager.destroy();
    }
  },
});
