/**
 * Timer manager
 * Manages all timers in one place to avoid memory leaks
 */

export class TimerManager {
  private timers = new Map<string, number>();

  /**
   * Set a timer
   * @param key Timer key
   * @param callback Callback function
   * @param delay Delay in milliseconds
   */
  set(key: string, callback: () => void, delay: number): void {
    // Clear any existing timer with the same key
    this.clear(key);

    const timerId = window.setTimeout(() => {
      callback();
      this.timers.delete(key);
    }, delay);

    this.timers.set(key, timerId);
  }

  /**
   * Clear the specified timer
   * @param key Timer key
   */
  clear(key: string): void {
    const timerId = this.timers.get(key);
    if (timerId !== undefined) {
      clearTimeout(timerId);
      this.timers.delete(key);
    }
  }

  /**
   * Clear all timers
   */
  clearAll(): void {
    for (const timerId of this.timers.values()) {
      clearTimeout(timerId);
    }
    this.timers.clear();
  }

  /**
   * Check whether a timer exists
   * @param key Timer key
   */
  has(key: string): boolean {
    return this.timers.has(key);
  }

  /**
   * Get the current number of timers
   */
  size(): number {
    return this.timers.size;
  }

  /**
   * Get all timer keys
   */
  keys(): string[] {
    return Array.from(this.timers.keys());
  }

  /**
   * Destroy the manager
   */
  destroy(): void {
    this.clearAll();
  }
}
