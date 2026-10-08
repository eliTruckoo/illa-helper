/**
 * Persistent cross-tab hover definitions.
 *
 * Thin wrapper over the background translation memory (`tm_definitions`, messages
 * with `ns: 'definitions'`): keyed by word + model/endpoint + a hash of the actual
 * definition prompt. Only successful definitions are stored; failures stay in the
 * in-memory negative cache of LookupCache. Disabled with the translation cache
 * setting, memory-only in incognito, and every failure is a miss.
 */

import type { ApiConfigItem } from '../../shared/types/api';
import type { AITranslationEntry } from '../types';
import { translationMemoryClient } from '../../core/translation/TranslationMemoryClient';
import { buildDefinitionFingerprintSource } from '../../core/translation/TranslationMemoryShared';

export function buildDefinitionFingerprint(
  apiConfigItem: ApiConfigItem,
  systemPrompt: string,
  options: { temperature: number; maxTokens: number },
): string {
  const config = apiConfigItem.config;
  return buildDefinitionFingerprintSource({
    protocolFamily: apiConfigItem.protocolFamily,
    endpoint: config.apiEndpoint,
    model: config.model,
    temperature: options.temperature,
    customParams: config.customParams,
    maxTokens: options.maxTokens,
    systemPrompt,
  });
}

/** Remembered definition of a word, or null (miss or any failure) */
export async function lookupRememberedDefinition(
  fingerprint: string,
  word: string,
): Promise<AITranslationEntry | null> {
  const [hit] = await translationMemoryClient.lookup(
    fingerprint,
    [word],
    'definitions',
  );
  const explain = hit?.status === 'ok' ? hit.pairs[0]?.translation : undefined;
  return explain ? { explain, source: 'ai-translation' } : null;
}

export function rememberDefinition(
  fingerprint: string,
  word: string,
  entry: AITranslationEntry,
): void {
  if (!entry.explain) return;
  translationMemoryClient.store(
    fingerprint,
    [
      {
        text: word,
        outcome: {
          status: 'ok',
          pairs: [{ original: word, translation: entry.explain }],
        },
      },
    ],
    'definitions',
  );
}
