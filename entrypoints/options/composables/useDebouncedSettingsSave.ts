import { getCurrentInstance, onBeforeUnmount, watch, type Ref } from 'vue';
// Relative import keeps the composable loadable by the regression script
import { createDebouncedTask } from '../../../src/utils/debounce';

/** Default debounce of settings saves (keystrokes, slider ticks) */
export const SETTINGS_SAVE_DEBOUNCE_MS = 400;

export interface DebouncedSettingsSave {
  /**
   * Record the current value as persisted (call after loading from storage),
   * so the watcher trigger caused by the load does not write it back.
   */
  markPersisted(): void;
  /** Save a pending change now and wait for the in-flight save */
  flush(): Promise<void>;
}

/**
 * Deep-watch a settings ref and persist it debounced.
 *
 * - Saves at most once per `wait` ms of inactivity (storage.sync has write
 *   quotas; a slider drag must not write on every tick).
 * - Nothing is written until markPersisted() was called once, and a value
 *   equal to the last persisted one is never written (skips the load trigger).
 * - A pending save is flushed on unmount and on pagehide (tab closed).
 */
export function useDebouncedSettingsSave<T>(
  source: Ref<T>,
  save: (value: T) => Promise<void>,
  wait: number = SETTINGS_SAVE_DEBOUNCE_MS,
): DebouncedSettingsSave {
  let loaded = false;
  let persistedSnapshot: string | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  const snapshot = (): string => JSON.stringify(source.value);

  const runSave = (): Promise<void> => {
    if (!loaded) return inFlight;
    const next = snapshot();
    if (next === persistedSnapshot) return inFlight;

    persistedSnapshot = next;
    const value = source.value;
    inFlight = inFlight
      .catch(() => undefined)
      .then(() => save(value))
      .catch((error) => {
        // Allow the same value to be retried by the next change
        persistedSnapshot = null;
        console.error('[Options] Failed to save settings:', error);
        throw error;
      });
    return inFlight;
  };

  const task = createDebouncedTask(
    () => runSave().catch(() => undefined),
    wait,
  );

  watch(
    source,
    () => {
      if (!loaded) return;
      task.schedule();
    },
    { deep: true },
  );

  const handlePageHide = () => task.flush();
  window.addEventListener('pagehide', handlePageHide);

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      window.removeEventListener('pagehide', handlePageHide);
      task.flush();
    });
  }

  return {
    markPersisted(): void {
      loaded = true;
      persistedSnapshot = snapshot();
    },
    async flush(): Promise<void> {
      task.cancel();
      await runSave().catch(() => undefined);
    },
  };
}
