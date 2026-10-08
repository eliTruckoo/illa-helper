<template>
  <Card>
    <CardHeader>
      <CardTitle>
        <h2 class="text-2xl font-bold text-foreground">
          {{ $t('translationCache.title') }}
        </h2>
      </CardTitle>
    </CardHeader>
    <CardContent class="space-y-6">
      <p class="text-sm text-muted-foreground">
        {{ $t('translationCache.description') }}
      </p>

      <div class="flex items-center justify-between">
        <div class="space-y-1 pr-4">
          <Label for="translation-cache-enabled">
            {{ $t('translationCache.enabled') }}
          </Label>
          <p class="text-xs text-muted-foreground">
            {{ $t('translationCache.enabledDescription') }}
          </p>
        </div>
        <Switch
          id="translation-cache-enabled"
          :model-value="cacheConfig.enabled"
          @update:model-value="cacheConfig.enabled = $event"
        />
      </div>

      <div class="border-t border-border pt-6 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-medium">
            {{ $t('translationCache.statsTitle') }}
          </h3>
          <Button
            variant="outline"
            size="sm"
            :disabled="loading"
            @click="refreshStats"
          >
            <RefreshCw
              class="w-4 h-4 mr-2"
              :class="{ 'animate-spin': loading }"
            />
            {{ $t('translationCache.refresh') }}
          </Button>
        </div>

        <p v-if="statsError" class="text-sm text-destructive">
          {{ $t('translationCache.statsUnavailable') }}
        </p>
        <div v-else class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div
            v-for="item in statItems"
            :key="item.label"
            class="rounded-lg border border-border p-3"
          >
            <div class="text-xs text-muted-foreground">{{ item.label }}</div>
            <div class="text-xl font-semibold text-foreground">
              {{ item.value }}
            </div>
            <div v-if="item.hint" class="text-xs text-muted-foreground">
              {{ item.hint }}
            </div>
          </div>
        </div>
        <p
          v-if="stats && !stats.persistent && !statsError"
          class="text-xs text-muted-foreground"
        >
          {{ $t('translationCache.memoryOnly') }}
        </p>
      </div>

      <div class="border-t border-border pt-6 grid gap-4 md:grid-cols-2">
        <div class="space-y-2">
          <Label for="translation-cache-max-entries">
            {{ $t('translationCache.maxEntries') }}
          </Label>
          <Input
            id="translation-cache-max-entries"
            type="number"
            :min="TM_MIN_MAX_ENTRIES"
            :max="TM_MAX_MAX_ENTRIES"
            step="1000"
            :model-value="cacheConfig.maxEntries"
            @update:model-value="cacheConfig.maxEntries = Number($event)"
          />
          <p class="text-xs text-muted-foreground">
            {{ $t('translationCache.maxEntriesDescription') }}
          </p>
        </div>
        <div class="space-y-2">
          <Label for="translation-cache-ttl">
            {{ $t('translationCache.ttlDays') }}
          </Label>
          <Input
            id="translation-cache-ttl"
            type="number"
            :min="TM_MIN_TTL_DAYS"
            :max="TM_MAX_TTL_DAYS"
            step="1"
            :model-value="cacheConfig.ttlDays"
            @update:model-value="cacheConfig.ttlDays = Number($event)"
          />
          <p class="text-xs text-muted-foreground">
            {{ $t('translationCache.ttlDaysDescription') }}
          </p>
        </div>
      </div>

      <div class="border-t border-border pt-6 flex flex-wrap gap-2">
        <Button variant="destructive" :disabled="clearing" @click="clearCache">
          <Trash2 class="w-4 h-4 mr-2" />
          {{ $t('translationCache.clear') }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { browser } from 'wxt/browser';
import { RefreshCw, Trash2 } from 'lucide-vue-next';
import { StorageService } from '@/src/modules/core/storage';
import { DEFAULT_TRANSLATION_CACHE_CONFIG } from '@/src/modules/shared/constants/defaults';
import type { TranslationCacheConfig } from '@/src/modules/shared/types/storage';
import {
  TM_MAX_MAX_ENTRIES,
  TM_MAX_TTL_DAYS,
  TM_MESSAGE_TYPES,
  TM_MIN_MAX_ENTRIES,
  TM_MIN_TTL_DAYS,
  resolveTmPolicy,
  type TmStats,
} from '@/src/modules/core/translation/TranslationMemoryShared';
import { TRANSLATION_BATCH_MAX_ITEMS } from '@/src/modules/processing/ProcessingContracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useDebouncedSettingsSave } from '../../composables/useDebouncedSettingsSave';

const { t } = useI18n();
const n = (value: number): string => value.toLocaleString();

const emit = defineEmits<{
  saveMessage: [message: string, type?: 'success' | 'error'];
}>();

const storageService = StorageService.getInstance();
const cacheConfig = ref<TranslationCacheConfig>({
  ...DEFAULT_TRANSLATION_CACHE_CONFIG,
});
const stats = ref<TmStats | null>(null);
const statsError = ref(false);
const loading = ref(false);
const clearing = ref(false);

// Only the translationCache block is written, merged into the latest stored settings
const settingsSaver = useDebouncedSettingsSave(
  cacheConfig,
  async (config) => {
    const settings = await storageService.getUserSettings();
    await storageService.saveUserSettings({
      ...settings,
      translationCache: resolveTmPolicy(config),
    });
    emit('saveMessage', t('settings.save'));
  },
  600,
);

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const statItems = computed(() => {
  const current = stats.value;
  if (!current) return [];
  const minSaved = Math.ceil(current.hits / TRANSLATION_BATCH_MAX_ITEMS);
  return [
    {
      label: t('translationCache.entries'),
      value: n(current.entries),
      hint: t('translationCache.entriesHint', {
        ok: n(current.okEntries),
        empty: n(current.emptyEntries),
      }),
    },
    {
      label: t('translationCache.size'),
      value: formatBytes(current.approxBytes),
      hint: '',
    },
    {
      label: t('translationCache.hits'),
      value: n(current.hits),
      hint: t('translationCache.sessionHits', {
        hits: n(current.sessionHits),
        lookups: n(current.sessionLookups),
      }),
    },
    {
      label: t('translationCache.requestsSaved'),
      value: current.hits === 0 ? '0' : `${n(minSaved)}–${n(current.hits)}`,
      hint: t('translationCache.requestsSavedHint'),
    },
  ];
});

async function refreshStats(): Promise<void> {
  loading.value = true;
  try {
    const reply = (await browser.runtime.sendMessage({
      type: TM_MESSAGE_TYPES.STATS,
    })) as TmStats | undefined;
    if (!reply || typeof reply.entries !== 'number') {
      throw new Error('No stats');
    }
    stats.value = reply;
    statsError.value = false;
  } catch (error) {
    console.error('Failed to load translation cache stats:', error);
    statsError.value = true;
  } finally {
    loading.value = false;
  }
}

async function clearCache(): Promise<void> {
  if (!window.confirm(t('translationCache.clearConfirm'))) return;
  clearing.value = true;
  try {
    const reply = (await browser.runtime.sendMessage({
      type: TM_MESSAGE_TYPES.CLEAR,
      scope: 'segments',
    })) as { success?: boolean } | undefined;
    if (!reply?.success) throw new Error('Clear failed');
    emit('saveMessage', t('translationCache.cleared'), 'success');
  } catch (error) {
    console.error('Failed to clear the translation cache:', error);
    emit('saveMessage', t('translationCache.clearError'), 'error');
  } finally {
    clearing.value = false;
    await refreshStats();
  }
}

onMounted(async () => {
  const settings = await storageService.getUserSettings();
  cacheConfig.value = {
    ...DEFAULT_TRANSLATION_CACHE_CONFIG,
    ...settings.translationCache,
  };
  settingsSaver.markPersisted();
  await refreshStats();
});
</script>
