<template>
  <div class="space-y-6">
    <!-- Current configuration selection -->
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 class="text-2xl font-bold text-foreground">
            {{ $t('translationSettings.title') }}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- API timeout configuration -->
        <div class="bg-muted/50 rounded-lg p-4 border border-border/50">
          <div class="flex items-center gap-2 mb-3">
            <div
              class="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center"
            >
              <svg
                class="h-4 w-4 text-primary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-foreground">
              {{ $t('translationSettings.apiRequestSettings') }}
            </h3>
          </div>

          <div class="space-y-3">
            <div class="space-y-2">
              <Label
                for="api-timeout"
                class="text-sm font-medium flex items-center gap-2"
              >
                {{ $t('translationSettings.timeoutSeconds') }}
                <span
                  class="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                >
                  {{ $t('translationSettings.globalSetting') }}
                </span>
              </Label>
              <p class="text-xs text-muted-foreground leading-relaxed">
                {{ $t('translationSettings.timeoutDescription') }}
                <code class="px-1 py-0.5 bg-muted rounded text-xs">0</code>
                {{ $t('translationSettings.noTimeoutLimit') }}
              </p>
              <div class="relative">
                <Input
                  id="api-timeout"
                  type="number"
                  :model-value="(settings.apiRequestTimeout / 1000).toFixed(3)"
                  @update:model-value="
                    settings.apiRequestTimeout = Number($event || 0) * 1000
                  "
                  :placeholder="$t('translationSettings.timeoutPlaceholder')"
                  min="0"
                  step="0.001"
                  class="pr-12"
                />
                <div
                  class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none"
                >
                  <span class="text-sm text-muted-foreground">
                    {{ $t('translationSettings.seconds') }}
                  </span>
                </div>
              </div>

              <!-- Quick setting options -->
              <div class="flex flex-wrap gap-2 mt-2">
                <button
                  v-for="preset in [10, 30, 60, 120, 0]"
                  :key="preset"
                  @click="settings.apiRequestTimeout = preset * 1000"
                  type="button"
                  class="inline-flex items-center rounded-md bg-background border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                  :class="{
                    'bg-primary/10 border-primary/20 text-primary':
                      settings.apiRequestTimeout / 1000 === preset,
                  }"
                >
                  {{
                    preset === 0
                      ? $t('translationSettings.unlimited')
                      : $t('translationSettings.secondsValue', {
                          value: preset,
                        })
                  }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="space-y-2">
          <Label>{{ $t('translationSettings.currentActiveConfig') }}</Label>
          <Select
            v-model="settings.activeApiConfigId"
            @update:model-value="handleActiveConfigChange"
          >
            <SelectTrigger>
              <SelectValue
                :placeholder="$t('translationSettings.selectApiConfig')"
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="config in settings.apiConfigs"
                :key="config.id"
                :value="config.id"
              >
                {{ config.name }} ({{
                  getProtocolFamilyLabel(config.protocolFamily)
                }})
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- Current configuration status -->
        <div v-if="activeConfig" class="p-3 bg-muted rounded-lg">
          <div class="text-sm space-y-1">
            <div>
              <strong>{{ $t('translationSettings.provider') }}:</strong>
              {{ getProtocolFamilyLabel(activeConfig.protocolFamily) }}
            </div>
            <div>
              <strong>{{ $t('translationSettings.model') }}:</strong>
              {{ activeConfig.config.model }}
            </div>
            <div class="truncate">
              <strong>{{ $t('translationSettings.endpoint') }}:</strong>
              {{ activeConfig.config.apiEndpoint }}
            </div>
            <div>
              <strong>{{ $t('translationSettings.status') }}:</strong>
              <span
                :class="
                  activeConfig.config.apiKey
                    ? 'text-green-600'
                    : 'text-destructive'
                "
              >
                {{
                  activeConfig.config.apiKey
                    ? $t('translationSettings.configured')
                    : $t('translationSettings.notConfigured')
                }}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Configuration management -->
    <Card>
      <CardHeader class="pb-3">
        <CardTitle>
          <div class="flex items-center justify-between">
            <h2 class="text-2xl font-bold text-foreground">
              {{ $t('translationSettings.manageConfig') }}
            </h2>
            <Button @click="showAddDialog = true" size="sm" variant="default">
              <PlusCircle class="h-4 w-4 mr-1" />
              {{ $t('translationSettings.addConfig') }}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent class="pt-0">
        <RadioGroup
          :model-value="settings.activeApiConfigId"
          @update:model-value="
            (value) => {
              settings.activeApiConfigId = value;
              handleActiveConfigChange();
            }
          "
        >
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              v-for="config in settings.apiConfigs"
              :key="config.id"
              class="rounded-lg border bg-card p-3 hover:shadow-sm transition-shadow"
              :class="{
                'border-primary border-2':
                  config.id === settings.activeApiConfigId,
              }"
            >
              <div class="flex items-center justify-between mb-1.5">
                <div class="flex items-center gap-1.5 min-w-0">
                  <ServerIcon
                    v-if="!isGeminiFamily(config.protocolFamily)"
                    class="h-3.5 w-3.5 text-green-500"
                  />
                  <GlobeIcon v-else class="h-3.5 w-3.5 text-primary" />
                  <h3
                    class="font-semibold text-sm truncate"
                    :title="config.name"
                  >
                    {{ config.name }}
                  </h3>
                </div>
                <div class="flex items-center">
                  <RadioGroupItem
                    :value="config.id"
                    :id="`config-${config.id}`"
                  />
                  <label
                    :for="`config-${config.id}`"
                    class="text-xs ml-1.5 text-muted-foreground cursor-pointer"
                  >
                    {{ $t('translationSettings.activate') }}
                  </label>
                </div>
              </div>

              <div class="text-xs text-muted-foreground space-y-0.5 mb-2">
                <div class="flex items-center gap-1">
                  <HashIcon class="h-3 w-3" />
                  <span
                    class="truncate"
                    :title="getProtocolFamilyLabel(config.protocolFamily)"
                  >
                    {{ getProtocolFamilyLabel(config.protocolFamily) }}
                  </span>
                </div>
                <div class="flex items-center gap-1">
                  <CodeIcon class="h-3 w-3" />
                  <span class="truncate" :title="config.config.model">
                    {{ config.config.model }}
                  </span>
                </div>
                <div class="flex items-center gap-1">
                  <KeyIcon class="h-3 w-3" />
                  <span class="flex items-center">
                    <span
                      class="inline-block w-1.5 h-1.5 rounded-full mr-1"
                      :class="
                        config.config.apiKey ? 'bg-green-500' : 'bg-red-500'
                      "
                    ></span>
                    {{
                      config.config.apiKey
                        ? $t('translationSettings.configured')
                        : $t('translationSettings.notConfigured')
                    }}
                  </span>
                </div>
              </div>

              <!-- Test result display -->
              <div
                v-if="cardTestResults[config.id]"
                class="text-xs p-2 rounded-md mb-2"
                :class="{
                  'bg-green-50 text-green-700 border border-green-200':
                    cardTestResults[config.id].success,
                  'bg-red-50 text-red-700 border border-red-200':
                    !cardTestResults[config.id].success,
                }"
              >
                <div class="flex items-center">
                  <CheckCircle2Icon
                    v-if="cardTestResults[config.id].success"
                    class="h-3 w-3 mr-1"
                  />
                  <XCircle v-else class="h-3 w-3 mr-1" />
                  <span class="font-medium">
                    {{
                      cardTestResults[config.id].success
                        ? $t('translationSettings.connectionSuccess')
                        : $t('translationSettings.connectionFailed')
                    }}
                  </span>
                </div>
                <div
                  v-if="cardTestResults[config.id].message"
                  class="mt-1 truncate"
                  :title="cardTestResults[config.id].message"
                >
                  {{ cardTestResults[config.id].message }}
                </div>
              </div>

              <div
                class="flex items-center justify-between pt-1 border-t border-border/40"
              >
                <div class="flex items-center gap-1">
                  <Button
                    @click="testCardApiConnection(config)"
                    :disabled="
                      cardTestingStates[config.id] || !config.config.apiKey
                    "
                    size="sm"
                    variant="ghost"
                    class="h-6 text-xs px-2"
                  >
                    <span
                      v-if="cardTestingStates[config.id]"
                      class="flex items-center"
                    >
                      <div
                        class="animate-spin rounded-full h-2 w-2 border-b border-current mr-1"
                      ></div>
                      {{ $t('translationSettings.testing') }}
                    </span>
                    <span v-else class="flex items-center">
                      <ZapIcon class="h-3 w-3 mr-1" />
                      {{ $t('translationSettings.test') }}
                    </span>
                  </Button>
                </div>
                <div class="flex items-center gap-1">
                  <Button
                    @click="editConfig(config)"
                    size="sm"
                    variant="ghost"
                    class="h-6 w-6 p-0"
                  >
                    <PencilIcon class="h-3 w-3" />
                  </Button>
                  <Button
                    v-if="settings.apiConfigs.length > 1"
                    @click="deleteConfig(config.id)"
                    size="sm"
                    variant="ghost"
                    class="h-6 w-6 p-0 text-destructive hover:bg-destructive/10"
                  >
                    <Trash2Icon class="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>

            <!-- Empty state -->
            <div
              v-if="settings.apiConfigs.length === 0"
              class="rounded-lg border border-dashed p-6 text-center text-muted-foreground col-span-full"
            >
              <FolderOpenIcon class="h-8 w-8 mx-auto mb-2 opacity-50" />
              {{ $t('translationSettings.noConfigMessage') }}
            </div>
          </div>
        </RadioGroup>
      </CardContent>
    </Card>

    <!-- Configuration dialog -->
    <div
      v-if="showAddDialog || editingConfig"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    >
      <Card
        class="w-full max-w-2xl m-4 max-h-[90vh] overflow-y-auto"
        @click.stop
        @mousedown.stop
      >
        <CardHeader>
          <div class="flex items-center justify-between">
            <CardTitle>
              {{
                editingConfig
                  ? $t('translationSettings.editConfig')
                  : $t('translationSettings.addNewConfig')
              }}
            </CardTitle>
            <Button
              @click="cancelEdit"
              variant="ghost"
              size="sm"
              class="h-8 w-8 p-0"
            >
              <X class="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="space-y-2">
            <Label>{{ $t('translationSettings.configName') }}</Label>
            <Input
              v-model="configForm.name"
              :placeholder="$t('translationSettings.inputConfigName')"
            />
          </div>

          <div class="space-y-2">
            <Label>{{ $t('translationSettings.serviceProvider') }}</Label>
            <Select
              v-model="configForm.presetKey"
              @update:model-value="handlePresetChange"
            >
              <SelectTrigger>
                <SelectValue
                  :placeholder="$t('translationSettings.selectServiceProvider')"
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">
                  {{ $t('translationSettings.openai') }}
                </SelectItem>
                <SelectItem value="deepseek">
                  {{ $t('translationSettings.deepseek') }}
                </SelectItem>
                <SelectItem value="silicon-flow">
                  {{ $t('translationSettings.siliconFlow') }}
                </SelectItem>
                <SelectItem value="gemini">
                  {{ $t('translationSettings.googleGemini') }}
                </SelectItem>
                <SelectItem value="custom-openai">
                  {{ $t('translationSettings.custom') }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="space-y-2">
            <Label>{{ $t('translationSettings.apiEndpoint') }}</Label>
            <Input
              v-model="configForm.config.apiEndpoint"
              :placeholder="$t('translationSettings.apiEndpointPlaceholder')"
            />
          </div>

          <div class="space-y-2">
            <Label>{{ $t('translationSettings.apiKey') }}</Label>
            <div class="relative">
              <Input
                :type="showPassword ? 'text' : 'password'"
                v-model="configForm.config.apiKey"
                :placeholder="$t('translationSettings.inputApiKey')"
                class="pr-10"
              />
              <Button
                @click="showPassword = !showPassword"
                type="button"
                variant="ghost"
                size="sm"
                class="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
              >
                <Eye
                  v-if="!showPassword"
                  class="h-4 w-4 text-muted-foreground"
                />
                <EyeOff v-else class="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          </div>

          <div class="space-y-2">
            <Label>{{ $t('translationSettings.modelName') }}</Label>
            <Input
              v-model="configForm.config.model"
              :placeholder="$t('translationSettings.inputModelName')"
            />
          </div>

          <!-- Temperature -->
          <div class="space-y-2">
            <Label>
              {{
                $t('translationSettings.temperatureParam', {
                  value: configForm.config.temperature,
                })
              }}
            </Label>
            <Slider
              :model-value="[configForm.config.temperature]"
              @update:model-value="updateTemperature"
              :min="0"
              :max="2"
              :step="0.1"
            />
          </div>

          <!-- Requests Per Second -->
          <div class="space-y-2">
            <Label>
              {{
                $t('translationSettings.requestsPerSecond', {
                  value:
                    configForm.config.requestsPerSecond === 0
                      ? $t('translationSettings.noLimit')
                      : configForm.config.requestsPerSecond +
                        ' ' +
                        $t('translationSettings.requestsPerSecondUnit'),
                })
              }}
            </Label>
            <p class="text-xs text-muted-foreground">
              {{ $t('translationSettings.requestsPerSecondDescription') }}
            </p>
            <Input
              type="number"
              v-model.number="configForm.config.requestsPerSecond"
              :min="0"
              :max="100"
              :placeholder="$t('translationSettings.inputRequestsPerSecond')"
            />
          </div>

          <div class="flex items-center justify-between">
            <div class="space-y-1">
              <Label>{{ $t('translationSettings.enableThinkingMode') }}</Label>
              <p class="text-xs text-muted-foreground">
                {{ $t('translationSettings.enableThinkingModeDescription') }}
              </p>
            </div>
            <Switch v-model="configForm.config.enable_thinking" />
          </div>

          <div class="flex items-center justify-between">
            <div class="space-y-1">
              <Label>
                {{ $t('translationSettings.includeThinkingParam') }}
              </Label>
              <p class="text-xs text-muted-foreground">
                {{ $t('translationSettings.includeThinkingParamDescription') }}
              </p>
            </div>
            <Switch v-model="configForm.config.includeThinkingParam" />
          </div>

          <!-- Custom API parameters -->
          <div class="space-y-3">
            <div class="space-y-1">
              <Label>{{ $t('translationSettings.customApiParams') }}</Label>
              <p class="text-xs text-muted-foreground">
                {{ $t('translationSettings.customApiParamsDescription') }}
              </p>
            </div>

            <div class="space-y-2">
              <div class="relative">
                <textarea
                  v-model="configForm.config.customParams"
                  @input="validateCustomParams"
                  placeholder='{"top_p": 0.9, "presence_penalty": 0.1, "max_tokens": 1000}'
                  class="w-full h-32 p-3 text-sm font-mono border rounded-md resize-none"
                  :class="{
                    'border-red-500 focus:border-red-500': customParamsError,
                    'border-green-500 focus:border-green-500':
                      customParamsValid &&
                      configForm.config.customParams?.trim(),
                  }"
                />
              </div>

              <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2">
                  <Button
                    @click="formatCustomParams"
                    size="sm"
                    variant="outline"
                    :disabled="!configForm.config.customParams?.trim()"
                  >
                    {{ $t('translationSettings.formatJson') }}
                  </Button>
                  <Button
                    @click="clearCustomParams"
                    size="sm"
                    variant="destructive"
                    :disabled="!configForm.config.customParams?.trim()"
                  >
                    {{ $t('translationSettings.clear') }}
                  </Button>
                  <Button
                    @click="showCustomParamsExample = !showCustomParamsExample"
                    size="sm"
                    variant="outline"
                  >
                    {{
                      showCustomParamsExample
                        ? $t('translationSettings.hideExample')
                        : $t('translationSettings.showExample')
                    }}
                  </Button>
                </div>

                <div
                  v-if="configForm.config.customParams?.trim()"
                  class="flex items-center space-x-1"
                >
                  <div
                    v-if="customParamsValid"
                    class="flex items-center text-green-600 text-xs"
                  >
                    <CheckCircle2Icon class="h-3 w-3 mr-1" />
                    {{ $t('translationSettings.jsonValid') }}
                  </div>
                  <div
                    v-else-if="customParamsError"
                    class="flex items-center text-red-600 text-xs"
                  >
                    <XCircle class="h-3 w-3 mr-1" />
                    {{ $t('translationSettings.jsonInvalid') }}
                  </div>
                </div>
              </div>

              <!-- Error message -->
              <div
                v-if="customParamsError"
                class="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200"
              >
                {{ customParamsError }}
              </div>

              <!-- Parameter examples -->
              <div
                v-if="showCustomParamsExample"
                class="text-xs bg-muted p-3 rounded border"
              >
                <div class="font-medium mb-2">
                  {{ $t('translationSettings.commonParamsExample') }}
                </div>
                <pre class="text-muted-foreground whitespace-pre-wrap">
                  {
                    "top_p": 0.9,
                    "presence_penalty": 0.1,
                    "frequency_penalty": 0.1,
                    "max_tokens": 1000,
                    "stop": ["\n", "###"]
                  }
                </pre>
                <div class="mt-2 text-muted-foreground">
                  <strong>{{ $t('translationSettings.note') }}</strong>
                  {{ $t('translationSettings.systemParamsNote') }}
                </div>
              </div>
            </div>
          </div>

          <!-- API connection test -->
          <div class="border-t border-border pt-4">
            <div class="flex items-center justify-between mb-2">
              <Label class="text-sm font-medium">
                {{ $t('translationSettings.apiConnectionTest') }}
              </Label>
              <Button
                @click="testApiConnection"
                :disabled="
                  isTestingConnection ||
                  !canTestConfig({
                    id: 'preview',
                    name: configForm.name,
                    protocolFamily: configForm.protocolFamily,
                    config: configForm.config,
                  })
                "
                size="sm"
                variant="default"
              >
                <span v-if="isTestingConnection" class="flex items-center">
                  <div
                    class="animate-spin rounded-full h-3 w-3 border-b-2 border-primary mr-1"
                  ></div>
                  {{ $t('translationSettings.testing') }}...
                </span>
                <span v-else>
                  {{ $t('translationSettings.testConnection') }}
                </span>
              </Button>
            </div>

            <!-- Test result display -->
            <div
              v-if="testResult"
              class="text-sm p-2 rounded-md"
              :class="{
                'bg-green-50 text-green-700 border border-green-200':
                  testResult.success,
                'bg-red-50 text-red-700 border border-red-200':
                  !testResult.success,
              }"
            >
              <div class="flex items-center">
                <CheckCircle2Icon
                  v-if="testResult.success"
                  class="h-4 w-4 mr-1"
                />
                <XCircle v-else class="h-4 w-4 mr-1" />
                <span class="font-medium">
                  {{
                    testResult.success
                      ? $t('translationSettings.apiConnectionSuccess')
                      : $t('translationSettings.apiConnectionFailed')
                  }}
                </span>
              </div>
              <div v-if="testResult.message" class="mt-1 text-xs">
                {{ testResult.message }}
              </div>
              <div
                v-if="testResult.success && testResult.model"
                class="mt-1 text-xs"
              >
                {{ $t('translationSettings.detectedModel') }}:
                {{ testResult.model }}
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter class="flex justify-end space-x-2">
          <Button @click="cancelEdit" variant="outline">
            {{ $t('translationSettings.cancel') }}
          </Button>
          <Button @click="saveConfig">
            {{
              editingConfig
                ? $t('translationSettings.save')
                : $t('translationSettings.add')
            }}
          </Button>
        </CardFooter>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, onUnmounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { StorageService } from '@/src/modules/core/storage';
import { useDebouncedSettingsSave } from '../../composables/useDebouncedSettingsSave';
import {
  testApiConnection as performApiTest,
  testGeminiConnection,
  ApiTestResult,
} from '@/src/utils';
import {
  UserSettings,
  DEFAULT_SETTINGS,
  ApiConfigItem,
  ApiConfig,
  ApiProtocolFamily,
} from '@/src/modules/shared/types';
import {
  API_PRESETS,
  ApiPresetKey,
  createEmptyApiConfig,
  getProtocolFamilyLabel,
  isGeminiFamily,
  supportsConnectionTest,
} from '@/src/modules/shared/ApiConfigHelpers';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  PlusCircle,
  CheckCircle2 as CheckCircle2Icon,
  Hash as HashIcon,
  Code as CodeIcon,
  Key as KeyIcon,
  Zap as ZapIcon,
  Pencil as PencilIcon,
  Trash2 as Trash2Icon,
  FolderOpen as FolderOpenIcon,
  Server as ServerIcon,
  Globe as GlobeIcon,
  XCircle,
  Eye,
  EyeOff,
  X,
} from 'lucide-vue-next';

const { t } = useI18n();

const settings = ref<UserSettings>({ ...DEFAULT_SETTINGS });
const storageService = StorageService.getInstance();

// Dialog state
const showAddDialog = ref(false);
const editingConfig = ref<ApiConfigItem | null>(null);

// Custom parameters state
const customParamsError = ref<string>('');
const customParamsValid = ref<boolean>(false);
const showCustomParamsExample = ref<boolean>(false);

// Password visibility state
const showPassword = ref<boolean>(false);

// Presets only fill in default values; the only data actually persisted is the protocol family and connection parameters
const createConfigFormState = () => ({
  name: API_PRESETS.openai.label,
  presetKey: 'openai' as ApiPresetKey,
  protocolFamily: ApiProtocolFamily.OPENAI_COMPATIBLE,
  config: {
    ...createEmptyApiConfig(),
    apiEndpoint: API_PRESETS.openai.apiEndpoint,
    model: API_PRESETS.openai.defaultModel,
  },
});

// Configuration form
const configForm = ref<{
  name: string;
  presetKey: ApiPresetKey;
  protocolFamily: ApiProtocolFamily;
  config: ApiConfig;
}>(createConfigFormState());

const emit = defineEmits<{
  saveMessage: [message: string];
}>();

// Computed properties
const activeConfig = computed(() => {
  return settings.value.apiConfigs.find(
    (config) => config.id === settings.value.activeApiConfigId,
  );
});

const canTestConfig = (config: ApiConfigItem): boolean =>
  supportsConnectionTest(config);

const handleActiveConfigChange = async () => {
  try {
    // v-model already changed activeApiConfigId; save it right away instead
    // of a second, separate setActiveApiConfig() write
    await nextTick();
    await settingsSaver.flush();
    emit('saveMessage', 'Active configuration updated');
  } catch (error) {
    console.error(t('errors.updateActiveConfigFailed'), error);
  }
};

const editConfig = (config: ApiConfigItem) => {
  editingConfig.value = config;

  configForm.value = {
    name: config.name,
    presetKey: inferPresetKey(config),
    protocolFamily: config.protocolFamily,
    config: { ...config.config },
  };

  // Validate custom parameters after loading the configuration
  if (configForm.value.config.customParams) {
    validateCustomParams();
  }
};

const inferPresetKey = (config: ApiConfigItem): ApiPresetKey => {
  for (const preset of Object.values(API_PRESETS)) {
    if (
      preset.protocolFamily === config.protocolFamily &&
      preset.apiEndpoint === config.config.apiEndpoint &&
      preset.defaultModel === config.config.model
    ) {
      return preset.key;
    }
  }

  return isGeminiFamily(config.protocolFamily) ? 'gemini' : 'custom-openai';
};

const deleteConfig = async (configId: string) => {
  if (confirm('Are you sure you want to delete this configuration?')) {
    try {
      await settingsSaver.flush();
      await storageService.removeApiConfig(configId);
      await loadSettings();
      emit('saveMessage', 'Configuration deleted');
    } catch (error) {
      console.error(t('errors.deleteConfigFailed'), error);
      alert(t('translationSettings.errors.deleteConfigFailed'));
    }
  }
};

const updateTemperature = (value: number[] | undefined) => {
  configForm.value.config.temperature = (value && value[0]) || 0;
};

// Custom parameter methods
const validateCustomParams = () => {
  const params = configForm.value.config.customParams?.trim();

  if (!params) {
    customParamsError.value = '';
    customParamsValid.value = false;
    return;
  }

  try {
    JSON.parse(params);
    customParamsError.value = '';
    customParamsValid.value = true;
  } catch (error) {
    customParamsValid.value = false;
    if (error instanceof SyntaxError) {
      customParamsError.value = `Invalid JSON format: ${error.message}`;
    } else {
      customParamsError.value = 'Failed to parse JSON';
    }
  }
};

const formatCustomParams = () => {
  const params = configForm.value.config.customParams?.trim();
  if (!params) return;

  try {
    const parsed = JSON.parse(params);
    configForm.value.config.customParams = JSON.stringify(parsed, null, 2);
    validateCustomParams();
  } catch (_) {
    // Do nothing if formatting fails; keep the existing content
  }
};

const clearCustomParams = () => {
  configForm.value.config.customParams = '';
  customParamsError.value = '';
  customParamsValid.value = false;
};

const handlePresetChange = (presetKey: unknown) => {
  if (typeof presetKey !== 'string') {
    return;
  }

  const preset = API_PRESETS[presetKey as ApiPresetKey];
  if (!preset) {
    return;
  }

  configForm.value.presetKey = preset.key;
  configForm.value.protocolFamily = preset.protocolFamily;
  configForm.value.config.apiEndpoint = preset.apiEndpoint;
  configForm.value.config.model = preset.defaultModel;

  if (!configForm.value.name) {
    configForm.value.name = preset.label;
  }
};

const saveConfig = async () => {
  if (!configForm.value.name || !configForm.value.config.apiKey) {
    alert(t('translationSettings.errors.fillRequiredFields'));
    return;
  }

  try {
    await settingsSaver.flush();
    if (editingConfig.value) {
      await storageService.updateApiConfig(
        editingConfig.value.id,
        configForm.value.name,
        configForm.value.protocolFamily,
        configForm.value.config,
      );
      emit('saveMessage', 'Configuration updated');
    } else {
      await storageService.addApiConfig(
        configForm.value.name,
        configForm.value.protocolFamily,
        configForm.value.config,
      );
      emit('saveMessage', 'Configuration added');
    }

    await loadSettings();
    cancelEdit();
  } catch (error) {
    console.error(t('errors.saveConfigFailed'), error);
    alert(t('translationSettings.errors.saveConfigFailed'));
  }
};

// Test connection state
const isTestingConnection = ref(false);
const testResult = ref<ApiTestResult | null>(null);

// Card test state
const cardTestingStates = ref<Record<string, boolean>>({});
const cardTestResults = ref<Record<string, ApiTestResult>>({});

// Card test result timers
const cardTestTimers = ref<Record<string, NodeJS.Timeout>>({});

// Test the API connection in the configuration dialog
const testApiConnection = async () => {
  const previewConfig: ApiConfigItem = {
    id: 'preview',
    name: configForm.value.name || 'preview',
    protocolFamily: configForm.value.protocolFamily,
    config: configForm.value.config,
  };

  if (!canTestConfig(previewConfig)) return;

  isTestingConnection.value = true;
  testResult.value = null;
  try {
    if (isGeminiFamily(previewConfig.protocolFamily)) {
      testResult.value = await testGeminiConnection(previewConfig.config);
    } else {
      testResult.value = await performApiTest(
        previewConfig,
        settings.value.apiRequestTimeout,
      );
    }
  } finally {
    isTestingConnection.value = false;
  }
};

// Test the API connection of a card configuration
const testCardApiConnection = async (configItem: ApiConfigItem) => {
  const { id } = configItem;

  if (!canTestConfig(configItem)) return;

  // Clear previous timers
  if (cardTestTimers.value[id]) {
    clearTimeout(cardTestTimers.value[id]);
    delete cardTestTimers.value[id];
  }

  cardTestingStates.value[id] = true;
  delete cardTestResults.value[id];

  try {
    if (isGeminiFamily(configItem.protocolFamily)) {
      cardTestResults.value[id] = await testGeminiConnection(configItem.config);
    } else {
      cardTestResults.value[id] = await performApiTest(
        configItem,
        settings.value.apiRequestTimeout,
      );
    }

    // Automatically clear the result after 5 seconds
    cardTestTimers.value[id] = setTimeout(() => {
      delete cardTestResults.value[id];
      delete cardTestTimers.value[id];
    }, 5000);
  } finally {
    cardTestingStates.value[id] = false;
  }
};

const cancelEdit = () => {
  showAddDialog.value = false;
  editingConfig.value = null;
  isTestingConnection.value = false;
  testResult.value = null;

  // Reset password visibility state
  showPassword.value = false;

  // Reset custom parameters state
  customParamsError.value = '';
  customParamsValid.value = false;
  showCustomParamsExample.value = false;

  configForm.value = createConfigFormState();
};

// Settings are saved debounced; storage writes made directly through
// StorageService (config add/update/delete) flush pending edits first and
// reload afterwards. Content scripts read settings from storage, so no
// runtime message is sent (only the background would receive it).
const settingsSaver = useDebouncedSettingsSave(
  settings,
  async (newSettings) => {
    try {
      await storageService.saveUserSettings(newSettings);
      emit('saveMessage', 'Settings saved');
    } catch (error) {
      console.error(t('errors.saveSettingsFailed'), error);
      emit('saveMessage', 'Failed to save settings');
    }
  },
);

const loadSettings = async () => {
  try {
    settings.value = await storageService.getUserSettings();
    settingsSaver.markPersisted();
  } catch (error) {
    console.error(t('errors.loadSettingsFailed'), error);
  }
};

// Clean up all timers
const clearAllTestTimers = () => {
  Object.values(cardTestTimers.value).forEach((timer) => {
    clearTimeout(timer);
  });
  cardTestTimers.value = {};
};

onMounted(async () => {
  await loadSettings();
});

// Clean up timers when the component unmounts
onUnmounted(() => {
  clearAllTestTimers();
});
</script>
