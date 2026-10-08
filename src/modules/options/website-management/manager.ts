import glob from './glob';
import { WebsiteRule, WebsiteManagementSettings, WebsiteStatus } from './types';

// Default settings
const DEFAULT_SETTINGS: WebsiteManagementSettings = { rules: [] };
const STORAGE_KEY = 'website-management-settings';

export class WebsiteManager {
  private settingsCache: WebsiteManagementSettings | null = null;
  private cacheTimestamp: number | null = null;

  /**
   * Get website status
   */
  async getWebsiteStatus(url: string): Promise<WebsiteStatus> {
    console.log(`[WebsiteManager] Getting website status: ${url}`);

    // Do not clear the cache immediately; check first whether it is still valid
    const settings = await this.getSettings();

    // Add a cache timestamp check; clear the cache if it is older than 5 seconds
    const now = Date.now();
    if (this.cacheTimestamp && now - this.cacheTimestamp > 5000) {
      console.log('[WebsiteManager] Cache expired, clearing cache');
      this.clearCache();
    }

    // Check blacklist rules first (highest priority)
    const blacklistRules = settings.rules.filter(
      (rule) => rule.type === 'blacklist' && rule.enabled,
    );

    for (const rule of blacklistRules) {
      if (glob.match(rule.pattern, url)) {
        console.log(`[WebsiteManager] Matched blacklist rule: ${rule.pattern}`);
        return 'blacklisted';
      }
    }

    // Then check whitelist rules
    const whitelistRules = settings.rules.filter(
      (rule) => rule.type === 'whitelist' && rule.enabled,
    );

    for (const rule of whitelistRules) {
      if (glob.match(rule.pattern, url)) {
        console.log(`[WebsiteManager] Matched whitelist rule: ${rule.pattern}`);
        return 'whitelisted';
      }
    }

    console.log('[WebsiteManager] Website status is normal');
    return 'normal';
  }

  /**
   * Check whether disabled by the blacklist
   */
  async isBlacklisted(url: string): Promise<boolean> {
    const status = await this.getWebsiteStatus(url);
    return status === 'blacklisted';
  }

  /**
   * Check whether in the whitelist
   */
  async isWhitelisted(url: string): Promise<boolean> {
    const status = await this.getWebsiteStatus(url);
    return status === 'whitelisted';
  }

  /**
   * Get all rules
   */
  async getRules(): Promise<WebsiteRule[]> {
    const settings = await this.getSettings();
    return settings.rules;
  }

  /**
   * Get rules by type
   */
  async getRulesByType(
    type: 'blacklist' | 'whitelist',
  ): Promise<WebsiteRule[]> {
    // Clear the cache to ensure the latest rule list
    this.clearCache();
    const settings = await this.getSettings();
    return settings.rules.filter((rule) => rule.type === type);
  }

  /**
   * Add a rule
   */
  async addRule(
    pattern: string,
    type: 'blacklist' | 'whitelist',
    description?: string,
  ): Promise<void> {
    if (!pattern) return;

    // Force-clear the cache to get the latest data, avoiding stale cache restoring deleted data
    this.clearCache();
    const settings = await this.getSettings();

    // Check whether a rule with the same pattern already exists (regardless of type)
    const existingRule = settings.rules.find(
      (rule) => rule.pattern === pattern,
    );

    if (existingRule) {
      if (existingRule.type === type) {
        return; // An identical rule already exists, do not add it again
      } else {
        // A single pattern can keep only one rule type.
        const ruleIndex = settings.rules.findIndex(
          (rule) => rule.id === existingRule.id,
        );
        if (ruleIndex > -1) {
          settings.rules.splice(ruleIndex, 1);
        }
      }
    }

    const newRule: WebsiteRule = {
      id: this.generateId(),
      pattern,
      type,
      enabled: true,
      createdAt: new Date(),
      description,
    };

    settings.rules.push(newRule);
    await this.saveSettings(settings);
    this.clearCache(); // clear the cache to ensure data is up to date
  }

  /**
   * Update a rule
   */
  async updateRule(id: string, updates: Partial<WebsiteRule>): Promise<void> {
    const settings = await this.getSettings();
    const ruleIndex = settings.rules.findIndex((rule) => rule.id === id);

    if (ruleIndex === -1) {
      throw new Error('Rule does not exist');
    }

    settings.rules[ruleIndex] = {
      ...settings.rules[ruleIndex],
      ...updates,
    };

    await this.saveSettings(settings);
    this.clearCache(); // clear the cache to ensure data is up to date
  }

  /**
   * Delete a rule
   */
  async removeRule(id: string): Promise<void> {
    const settings = await this.getSettings();
    const ruleIndex = settings.rules.findIndex((rule) => rule.id === id);

    if (ruleIndex > -1) {
      settings.rules.splice(ruleIndex, 1);
      await this.saveSettings(settings);
      this.clearCache(); // clear the cache to ensure data is up to date
    }
  }

  /**
   * Delete rules in batch
   */
  async removeRules(ids: string[]): Promise<void> {
    const settings = await this.getSettings();
    settings.rules = settings.rules.filter((rule) => !ids.includes(rule.id));
    await this.saveSettings(settings);
    this.clearCache(); // clear the cache to ensure data is up to date
  }

  /**
   * Replace the website rule list with rules in the current format.
   */
  async replaceRules(rules: WebsiteRule[]): Promise<number> {
    const normalizedSettings = this.normalizeSettings({ rules });
    await this.saveSettings(normalizedSettings);
    this.clearCache();
    return normalizedSettings.rules.length;
  }

  /**
   * Enable/disable a rule
   */
  async toggleRule(id: string): Promise<void> {
    const settings = await this.getSettings();
    const rule = settings.rules.find((rule) => rule.id === id);

    if (rule) {
      rule.enabled = !rule.enabled;
      await this.saveSettings(settings);
      this.clearCache(); // clear the cache to ensure data is up to date
    }
  }

  /**
   * Get settings
   */
  private async getSettings(): Promise<WebsiteManagementSettings> {
    if (this.settingsCache) {
      return this.settingsCache;
    }

    try {
      const result = await browser.storage.sync.get(STORAGE_KEY);
      if (result && result[STORAGE_KEY]) {
        const settings = this.normalizeSettings(
          JSON.parse(result[STORAGE_KEY]),
        );
        this.settingsCache = settings;
        this.cacheTimestamp = Date.now();
        return settings;
      }

      this.settingsCache = DEFAULT_SETTINGS;
      return DEFAULT_SETTINGS;
    } catch (error) {
      console.error('Failed to get website management settings:', error);
      this.settingsCache = DEFAULT_SETTINGS;
      return DEFAULT_SETTINGS;
    }
  }

  /**
   * Save settings
   */
  private async saveSettings(
    settings: WebsiteManagementSettings,
  ): Promise<void> {
    try {
      const serializedSettings = JSON.stringify(settings);
      await browser.storage.sync.set({ [STORAGE_KEY]: serializedSettings });
      this.settingsCache = settings;
      this.cacheTimestamp = Date.now(); // update the cache
    } catch (error) {
      console.error('Failed to save website management settings:', error);
    }
  }

  private normalizeSettings(rawSettings: unknown): WebsiteManagementSettings {
    if (!rawSettings || typeof rawSettings !== 'object') {
      return DEFAULT_SETTINGS;
    }

    const settings = rawSettings as Partial<WebsiteManagementSettings>;
    const rawRules = Array.isArray(settings.rules) ? settings.rules : [];

    return {
      rules: rawRules
        .map((rule) => this.normalizeRule(rule))
        .filter((rule): rule is WebsiteRule => rule !== null),
    };
  }

  private normalizeRule(rawRule: unknown): WebsiteRule | null {
    if (!rawRule || typeof rawRule !== 'object') {
      return null;
    }

    const rule = rawRule as Partial<WebsiteRule>;
    if (
      !rule.id ||
      !rule.pattern ||
      typeof rule.enabled !== 'boolean' ||
      !rule.createdAt ||
      (rule.type !== 'blacklist' && rule.type !== 'whitelist')
    ) {
      return null;
    }

    const createdAt = new Date(rule.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      return null;
    }

    return {
      id: rule.id,
      pattern: rule.pattern,
      type: rule.type,
      enabled: rule.enabled,
      createdAt,
      description: rule.description,
    };
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.settingsCache = null;
    this.cacheTimestamp = null;
  }
}
