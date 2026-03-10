// Multi-provider AI Service for CSV data enrichment
// Supports: Gemini, OpenAI, Claude, DeepSeek, Groq, DeepInfra, OpenRouter, Local LLM (LM Studio)
import { getSyncedItem, setSyncedItem, removeSyncedItem } from '@/lib/syncedStorage';
export type AIProvider = 'gemini' | 'openai' | 'claude' | 'deepseek' | 'groq' | 'deepinfra' | 'openrouter' | 'local';

export interface AIProviderConfig {
    provider: AIProvider;
    apiKey: string;
    model?: string;
    localEndpoint?: string;  // For local LLM (e.g., http://localhost:1234/v1)
}

export interface AIColumnConfig {
    columnName: string;
    prompt: string;
    processedRows: Set<number>;
    isProcessing: boolean;
    createdAt: Date;
}

// Default models for each provider
const DEFAULT_MODELS: Record<AIProvider, string> = {
    gemini: 'gemini-pro',
    openai: 'gpt-4o-mini',
    claude: 'claude-3-haiku-20240307',
    deepseek: 'deepseek-chat',
    groq: 'llama-3.3-70b-versatile',
    deepinfra: 'openai/gpt-oss-120b',
    openrouter: 'openai/gpt-oss-120b',
    local: 'local-model'
};

// API endpoints - direct URLs for production (Vercel has no Vite proxy)
const API_ENDPOINTS: Record<AIProvider, string> = {
    gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
    openai: 'https://api.openai.com/v1/chat/completions',
    claude: 'https://api.anthropic.com/v1/messages',
    deepseek: 'https://api.deepseek.com/v1/chat/completions',
    groq: 'https://api.groq.com/openai/v1/chat/completions',
    deepinfra: 'https://api.deepinfra.com/v1/openai/chat/completions',
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    local: 'http://localhost:1234/v1/chat/completions'  // Default, can be overridden
};

// Store for AI column configurations (persisted to localStorage)
const AI_COLUMNS_STORAGE_KEY = 'layerforge_ai_columns';
const aiColumnConfigs = new Map<string, AIColumnConfig>();

// Load AI column configs from localStorage on startup
function loadAIColumnConfigs() {
    try {
        const saved = getSyncedItem(AI_COLUMNS_STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved) as Array<[string, { columnName: string; prompt: string; processedRows: number[]; createdAt: string }]>;
            parsed.forEach(([key, config]) => {
                aiColumnConfigs.set(key, {
                    columnName: config.columnName,
                    prompt: config.prompt,
                    processedRows: new Set(config.processedRows),
                    isProcessing: false,
                    createdAt: new Date(config.createdAt)
                });
            });
        }
    } catch { /* ignore parse errors */ }
}

// Save AI column configs to localStorage
function saveAIColumnConfigs() {
    try {
        const serializable = Array.from(aiColumnConfigs.entries()).map(([key, config]) => [
            key,
            {
                columnName: config.columnName,
                prompt: config.prompt,
                processedRows: Array.from(config.processedRows),
                createdAt: config.createdAt.toISOString()
            }
        ]);
        setSyncedItem(AI_COLUMNS_STORAGE_KEY, JSON.stringify(serializable));
    } catch { /* ignore storage errors */ }
}

// Initialize on module load
loadAIColumnConfigs();

// Current provider settings (can be persisted to localStorage)
let currentProvider: AIProviderConfig = {
    provider: 'gemini',
    apiKey: '',
    model: DEFAULT_MODELS.gemini
};

// Provider settings persistence
const STORAGE_KEY = 'layerforge_ai_settings';
const TEMPLATES_STORAGE_KEY = 'layerforge_prompt_templates';
const API_KEYS_STORAGE_KEY = 'layerforge_ai_api_keys';  // Separate storage for per-provider API keys

// Per-provider API keys storage
interface PerProviderApiKeys {
    gemini?: string;
    openai?: string;
    claude?: string;
    deepseek?: string;
    groq?: string;
    deepinfra?: string;
    openrouter?: string;
}

// In-memory cache for per-provider API keys
let providerApiKeys: PerProviderApiKeys = {};

// Load per-provider API keys from localStorage
function loadProviderApiKeys(): PerProviderApiKeys {
    try {
        const saved = getSyncedItem(API_KEYS_STORAGE_KEY);
        if (saved) {
            providerApiKeys = JSON.parse(saved);

        }
    } catch (e) {
        console.error('Failed to load provider API keys:', e);
    }
    return providerApiKeys;
}

// Save per-provider API keys to localStorage
function saveProviderApiKeys() {
    try {
        setSyncedItem(API_KEYS_STORAGE_KEY, JSON.stringify(providerApiKeys));
    } catch (e) {
        console.error('Failed to save provider API keys:', e);
    }
}

// Get API key for a specific provider
export function getApiKeyForProvider(provider: AIProvider): string {
    // Local LLM doesn't use API keys
    if (provider === 'local') return '';
    return providerApiKeys[provider] || '';
}

// Set API key for a specific provider
export function setApiKeyForProvider(provider: AIProvider, apiKey: string) {
    // Local LLM doesn't use API keys
    if (provider === 'local') return;
    providerApiKeys[provider] = apiKey;
    saveProviderApiKeys();
}

// Prompt template types
export interface SavedPromptTemplate {
    id: string;
    name: string;
    prompt: string;
    createdAt: string;
}

// Prompt template management
export function getSavedPromptTemplates(): SavedPromptTemplate[] {
    try {
        const saved = getSyncedItem(TEMPLATES_STORAGE_KEY);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.error('Failed to load prompt templates:', e);
    }
    return [];
}

export function savePromptTemplate(name: string, prompt: string): SavedPromptTemplate {
    const templates = getSavedPromptTemplates();
    const newTemplate: SavedPromptTemplate = {
        id: `template_${Date.now()}`,
        name: name.trim(),
        prompt: prompt.trim(),
        createdAt: new Date().toISOString()
    };
    templates.push(newTemplate);
    try {
        setSyncedItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
    } catch (e) {
        console.error('Failed to save prompt template:', e);
    }
    return newTemplate;
}

export function deletePromptTemplate(id: string): void {
    const templates = getSavedPromptTemplates();
    const filtered = templates.filter(t => t.id !== id);
    try {
        setSyncedItem(TEMPLATES_STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {
        console.error('Failed to delete prompt template:', e);
    }
}

export function loadAISettings(): AIProviderConfig {
    // Load per-provider API keys first
    loadProviderApiKeys();

    try {
        const saved = getSyncedItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            currentProvider = { ...currentProvider, ...parsed };

            // Migrate old single API key to per-provider storage if it exists
            if (parsed.apiKey && parsed.provider && !providerApiKeys[parsed.provider as keyof PerProviderApiKeys]) {
                providerApiKeys[parsed.provider as keyof PerProviderApiKeys] = parsed.apiKey;
                saveProviderApiKeys();
            }

            // Always use the API key for the current provider from per-provider storage
            currentProvider.apiKey = getApiKeyForProvider(currentProvider.provider);
        }
    } catch (e) {
        console.error('Failed to load AI settings:', e);
    }
    return currentProvider;
}

export function saveAISettings(config: Partial<AIProviderConfig>) {
    currentProvider = { ...currentProvider, ...config };

    // Save API key to per-provider storage
    if (config.apiKey !== undefined && currentProvider.provider !== 'local') {
        setApiKeyForProvider(currentProvider.provider, config.apiKey);
    }

    try {
        // Save general settings (without API key - that's stored per-provider now)
        setSyncedItem(STORAGE_KEY, JSON.stringify({
            provider: currentProvider.provider,
            model: currentProvider.model,
            localEndpoint: currentProvider.localEndpoint
        }));
    } catch (e) {
        console.error('Failed to save AI settings:', e);
    }
}

export function clearAISettings() {
    currentProvider = {
        provider: 'gemini',
        apiKey: '',
        model: DEFAULT_MODELS.gemini
    };
    // Clear per-provider API keys
    providerApiKeys = {};
    try {
        removeSyncedItem(STORAGE_KEY);
        removeSyncedItem(API_KEYS_STORAGE_KEY);
    } catch (e) {
        console.error('Failed to clear AI settings:', e);
    }
    return currentProvider;
}

export function getAISettings(): AIProviderConfig {
    // Always return the current provider with its correct API key
    return {
        ...currentProvider,
        apiKey: getApiKeyForProvider(currentProvider.provider)
    };
}

export function getAvailableModels(provider: AIProvider): string[] {
    const models: Record<AIProvider, string[]> = {
        gemini: ['gemini-pro', 'gemini-2.0-flash-exp', 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest'],
        openai: ['gpt-5-nano', 'gpt-4o-mini', 'gpt-4o', 'o1-mini', 'o1-preview', 'gpt-4-turbo', 'gpt-3.5-turbo'],
        claude: ['claude-3-haiku-20240307', 'claude-3-sonnet-20240229', 'claude-3-opus-20240229', 'claude-3-5-sonnet-20241022'],
        deepseek: ['deepseek-chat', 'deepseek-coder'],
        groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama-3.2-90b-vision-preview', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
        deepinfra: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'deepseek/deepseek-v3.2'],
        openrouter: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'deepseek/deepseek-v3.2'],
        local: ['local-model']  // LM Studio auto-selects loaded model
    };
    return models[provider] || [];
}

// AI Column config management
export function getAIColumnConfig(columnName: string): AIColumnConfig | undefined {
    return aiColumnConfigs.get(columnName);
}

export function setAIColumnConfig(columnName: string, config: AIColumnConfig) {
    aiColumnConfigs.set(columnName, config);
    saveAIColumnConfigs();
}

export function removeAIColumnConfig(columnName: string) {
    aiColumnConfigs.delete(columnName);
    saveAIColumnConfigs();
}

export function getAllAIColumns(): string[] {
    return Array.from(aiColumnConfigs.keys());
}

export function isAIColumn(columnName: string): boolean {
    return aiColumnConfigs.has(columnName);
}

export function getUnprocessedRowCount(columnName: string, totalRows: number): number {
    const config = aiColumnConfigs.get(columnName);
    if (!config) return 0;
    return totalRows - config.processedRows.size;
}

export function markRowProcessed(columnName: string, rowIndex: number) {
    const config = aiColumnConfigs.get(columnName);
    if (config) {
        config.processedRows.add(rowIndex);
    }
}

/**
 * Replace {column_name} and {column_name.field} placeholders with actual values from the row
 * Supports dot notation for extracting fields from JSON columns (e.g., {__enrich_linkedin.firstName})
 * Also supports enrichment data structure which wraps data in a `data` property
 * Now supports bracket notation for array indices (e.g., {col.experience[0].title})
 */
export function interpolatePrompt(prompt: string, row: Record<string, string>, headers: string[]): string {
    let result = prompt;

    // Handle complex field references like {column.field}, {column.field[0].subfield}, etc.
    // Match: {columnName followed by . or [ and then any valid path characters}
    const complexPathRegex = /\{([^}.\[\]]+)((?:\.[^}\[\]]+|\[[^\]]+\])+)\}/gi;
    result = result.replace(complexPathRegex, (match, columnName, fieldPath) => {
        const columnValue = row[columnName];
        if (!columnValue) return '';

        try {
            // Try to parse as JSON
            const jsonData = JSON.parse(columnValue);

            // Check if this is an enrichment data structure (has source, sourceName, data properties)
            // If so, navigate into the `data` property for field lookup
            let dataRoot: unknown = jsonData;
            if (jsonData && typeof jsonData === 'object' && 'data' in jsonData && typeof jsonData.data === 'object') {
                dataRoot = jsonData.data;
            }

            // Parse the path to handle both dot notation and bracket notation
            // e.g., ".experience[0].title" -> ["experience", "0", "title"]
            const parts: string[] = [];
            let currentPart = '';
            let inBracket = false;

            for (let i = 0; i < fieldPath.length; i++) {
                const char = fieldPath[i];
                if (char === '[') {
                    if (currentPart) {
                        parts.push(currentPart);
                        currentPart = '';
                    }
                    inBracket = true;
                } else if (char === ']') {
                    if (currentPart) {
                        parts.push(currentPart);
                        currentPart = '';
                    }
                    inBracket = false;
                } else if (char === '.' && !inBracket) {
                    if (currentPart) {
                        parts.push(currentPart);
                        currentPart = '';
                    }
                } else {
                    currentPart += char;
                }
            }
            if (currentPart) {
                parts.push(currentPart);
            }

            // Navigate the path
            let value: unknown = dataRoot;
            for (const part of parts) {
                if (value === null || value === undefined) return '';

                if (Array.isArray(value)) {
                    // Check if part is an integer index
                    const index = parseInt(part, 10);
                    if (!isNaN(index) && String(index) === part) {
                        value = value[index];
                        continue;
                    }
                    // Map property over array items (backward compatibility)
                    const values = value.map(item => {
                        if (item && typeof item === 'object') {
                            return (item as Record<string, unknown>)[part];
                        }
                        return undefined;
                    }).filter(v => v !== undefined);
                    value = values.length === 1 ? values[0] : values.join(', ');
                    continue;
                }

                if (typeof value === 'object' && part in (value as Record<string, unknown>)) {
                    value = (value as Record<string, unknown>)[part];
                } else {
                    return ''; // Field not found
                }
            }

            // Return value as string
            if (value === null || value === undefined) return '';
            if (typeof value === 'object') {
                // For arrays and objects, return JSON string
                return JSON.stringify(value);
            }
            return String(value);
        } catch {
            // Not JSON, return empty
            return '';
        }
    });

    // Then handle simple placeholders like {column}
    headers.forEach(header => {
        const placeholder = new RegExp(`\\{${header}\\}`, 'gi');
        result = result.replace(placeholder, row[header] || '');
    });

    return result;
}

/**
 * Call AI API based on current provider
 */
export async function callAI(prompt: string, config?: Partial<AIProviderConfig>): Promise<string> {
    const settings = { ...currentProvider, ...config };

    // Local LLM doesn't require API key
    if (settings.provider !== 'local' && !settings.apiKey) {
        throw new Error('API key not configured. Please set up your AI provider in settings.');
    }

    const model = settings.model || DEFAULT_MODELS[settings.provider];

    // CORS warning for non-Gemini, non-local, non-Groq, non-DeepInfra, non-OpenRouter providers
    if (settings.provider !== 'gemini' && settings.provider !== 'local' && settings.provider !== 'groq' && settings.provider !== 'deepinfra' && settings.provider !== 'openrouter') {
        console.warn(`Note: ${settings.provider} API may have CORS restrictions in browser. If you get "Failed to fetch", switch to Gemini or use a backend proxy.`);
    }

    try {
        switch (settings.provider) {
            case 'gemini':
                return await callGemini(settings.apiKey, model, prompt);
            case 'openai':
                return await callOpenAI(settings.apiKey, model, prompt);
            case 'claude':
                return await callClaude(settings.apiKey, model, prompt);
            case 'deepseek':
                return await callDeepSeek(settings.apiKey, model, prompt);
            case 'groq':
                return await callGroq(settings.apiKey, model, prompt);
            case 'deepinfra':
                return await callDeepInfra(settings.apiKey, model, prompt);
            case 'openrouter':
                return await callOpenRouter(settings.apiKey, model, prompt);
            case 'local':
                return await callLocalLLM(settings.localEndpoint || API_ENDPOINTS.local, model, prompt);
            default:
                throw new Error(`Unknown provider: ${settings.provider}`);
        }
    } catch (error) {
        if (error instanceof TypeError && error.message === 'Failed to fetch') {
            if (settings.provider === 'local') {
                throw new Error('Failed to connect to local LLM. Make sure LM Studio server is running.');
            }
            throw new Error(`CORS blocked: ${settings.provider} API doesn't allow direct browser calls. Please use Gemini, Groq, or set up a backend proxy.`);
        }
        throw error;
    }
}

async function callGemini(apiKey: string, model: string, prompt: string): Promise<string> {
    const response = await fetch(
        `${API_ENDPOINTS.gemini}/${model}:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
            })
        }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

async function callOpenAI(apiKey: string, model: string, prompt: string): Promise<string> {
    // Different models need different parameters
    const isReasoningModel = model.includes('gpt-5') || model.includes('o1-');

    // Build request body based on model type
    let body: Record<string, unknown>;

    if (isReasoningModel) {
        // GPT-5 and O1 models - use minimal parameters only
        body = {
            model,
            messages: [{ role: 'user', content: prompt }]
        };
    } else {
        // Standard GPT models
        body = {
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 500
        };
    }

    const response = await fetch(API_ENDPOINTS.openai, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
}

async function callClaude(apiKey: string, model: string, prompt: string): Promise<string> {
    const response = await fetch(API_ENDPOINTS.claude, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 500
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `Claude API error: ${response.status}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text?.trim() || '';
}

async function callDeepSeek(apiKey: string, model: string, prompt: string): Promise<string> {
    const response = await fetch(API_ENDPOINTS.deepseek, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 2000  // Increased for longer JSON responses like email sequences
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `DeepSeek API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
}

async function callGroq(apiKey: string, model: string, prompt: string): Promise<string> {
    // Groq uses OpenAI-compatible API format
    const response = await fetch(API_ENDPOINTS.groq, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 2000
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `Groq API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
}

async function callDeepInfra(apiKey: string, model: string, prompt: string): Promise<string> {
    // DeepInfra uses OpenAI-compatible API format
    const response = await fetch(API_ENDPOINTS.deepinfra, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 2000
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `DeepInfra API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
}

async function callOpenRouter(apiKey: string, model: string, prompt: string): Promise<string> {
    // OpenRouter uses OpenAI-compatible API format
    const response = await fetch(API_ENDPOINTS.openrouter, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 2000
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
}

async function callLocalLLM(endpoint: string, model: string, prompt: string): Promise<string> {
    // LM Studio uses OpenAI-compatible API format
    const requestBody = {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 500
    };

    console.log('Calling Local LLM:', endpoint, requestBody);

    const response = await fetch(endpoint, {
        method: 'POST',
        mode: 'cors',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        let errorMsg = `Local LLM error: ${response.status}`;
        try {
            const error = await response.json();
            errorMsg = error.error?.message || errorMsg;
        } catch {
            // Ignore JSON parse errors
        }
        throw new Error(errorMsg);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * Process multiple rows with AI (parallel batch processing for speed)
 * Supports cancellation via AbortSignal
 */
export async function processRowsWithAI(
    rows: Record<string, string>[],
    headers: string[],
    prompt: string,
    rowIndices: number[],
    onProgress: (completed: number, total: number, rowIndex: number, result: string) => void,
    concurrency: number = 5,  // Process 5 rows at a time
    batchDelayMs: number = 200,  // Delay between batches
    signal?: AbortSignal  // Optional abort signal for cancellation
): Promise<Map<number, string>> {
    const results = new Map<number, string>();
    let completedCount = 0;

    // Process a single row
    const processRow = async (rowIndex: number): Promise<void> => {
        // Check if cancelled before processing
        if (signal?.aborted) return;

        const row = rows[rowIndex];
        if (!row) return;

        try {
            const interpolatedPrompt = interpolatePrompt(prompt, row, headers);
            const result = await callAI(interpolatedPrompt);
            results.set(rowIndex, result);
            completedCount++;
            onProgress(completedCount, rowIndices.length, rowIndex, result);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Error';
            results.set(rowIndex, `[Error: ${errorMsg}]`);
            completedCount++;
            onProgress(completedCount, rowIndices.length, rowIndex, `[Error: ${errorMsg}]`);
        }
    };

    // Process in batches of `concurrency` rows at a time
    for (let i = 0; i < rowIndices.length; i += concurrency) {
        // Check if cancelled before starting batch
        if (signal?.aborted) {
            break;
        }

        const batch = rowIndices.slice(i, i + concurrency);

        // Process entire batch in parallel
        await Promise.all(batch.map(rowIndex => processRow(rowIndex)));

        // Small delay between batches to avoid rate limits
        if (i + concurrency < rowIndices.length && batchDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, batchDelayMs));
        }
    }

    return results;
}

/**
 * Extract column references from a prompt
 * Handles both {column} and {column.field} syntax
 * Ignores JSON syntax like {"key": "value"} - only matches valid variable names
 */
export function extractColumnReferences(prompt: string): string[] {
    // Match {content} patterns
    const matches = prompt.match(/\{([^}]+)\}/g) || [];

    // Filter to only valid column references (letters, numbers, underscores, dots, brackets for array access)
    // Exclude anything that looks like JSON (contains : or " or starts with ")
    return matches
        .map(m => m.slice(1, -1))  // Remove { and }
        .filter(content => {
            // Skip if it looks like JSON (contains quotes or colons not after brackets)
            if (content.includes('"') || content.includes("'")) return false;
            if (content.includes(':')) return false;

            // Valid column reference pattern: starts with letter/underscore, contains only valid chars
            // Allows: column_name, column.field, column[0].field
            return /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*|\[\d+\])*$/.test(content);
        });
}

/**
 * Extract base column names from a prompt (strips field paths)
 * e.g., {column.field} -> column
 */
export function extractBaseColumnNames(prompt: string): string[] {
    const refs = extractColumnReferences(prompt);
    return [...new Set(refs.map(ref => ref.split('.')[0]))];
}

/**
 * Validate that all column references exist
 * Handles dot notation - only validates the base column name
 */
export function validatePromptColumns(prompt: string, headers: string[]): string[] {
    const baseColumns = extractBaseColumnNames(prompt);
    const headersLower = headers.map(h => h.toLowerCase());
    return baseColumns.filter(col => !headersLower.includes(col.toLowerCase()));
}

/**
 * Parse a JSON array response from AI and convert to column data
 * Returns null if the response is not a valid JSON array
 * 
 * Example input: [{"step": 1, "subject": "Hello", "body": "Text"}, {"step": 2, ...}]
 * Example output with prefix "email":
 * {
 *   columns: ["email_1_step", "email_1_subject", "email_1_body", "email_2_step", ...],
 *   data: { "email_1_step": "1", "email_1_subject": "Hello", "email_1_body": "Text", ... }
 * }
 */
export interface ParsedJsonArrayResult {
    columns: string[];
    data: Record<string, string>;
}

export function parseJsonArrayResponse(response: string, columnPrefix: string): ParsedJsonArrayResult | null {
    // Clean up the response - sometimes AI wraps with markdown code blocks or adds extra text
    let cleaned = response.trim();

    // Remove markdown code blocks if present (anywhere in the response)
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
        cleaned = codeBlockMatch[1].trim();
    }

    // If doesn't start with [, try to find a JSON array in the response
    if (!cleaned.startsWith('[')) {
        // Find the first [ and last ] in the response
        const startIdx = cleaned.indexOf('[');
        const endIdx = cleaned.lastIndexOf(']');

        if (startIdx !== -1 && endIdx > startIdx) {
            cleaned = cleaned.slice(startIdx, endIdx + 1);
        } else {
            return null;
        }
    }

    // Try to fix common JSON issues from AI output
    let jsonStr = cleaned;

    // Fix unescaped newlines inside string values
    // This is a common issue where AI outputs actual line breaks instead of \n
    jsonStr = fixUnescapedNewlinesInJson(jsonStr);

    // Fix truncated JSON by adding missing closing brackets
    const openBrackets = (jsonStr.match(/\[/g) || []).length;
    const closeBrackets = (jsonStr.match(/\]/g) || []).length;
    const openBraces = (jsonStr.match(/\{/g) || []).length;
    const closeBraces = (jsonStr.match(/\}/g) || []).length;

    // Add missing closing braces and brackets
    for (let i = 0; i < openBraces - closeBraces; i++) {
        jsonStr += '}';
    }
    for (let i = 0; i < openBrackets - closeBrackets; i++) {
        jsonStr += ']';
    }

    try {
        const parsed = JSON.parse(jsonStr);

        // Must be an array
        if (!Array.isArray(parsed) || parsed.length === 0) {
            return null;
        }

        // Get all unique field names from all items
        const fieldNames = new Set<string>();
        parsed.forEach((item: unknown) => {
            if (item && typeof item === 'object') {
                Object.keys(item as Record<string, unknown>).forEach(key => fieldNames.add(key));
            }
        });

        if (fieldNames.size === 0) {
            return null;
        }

        // Build column names and data
        const columns: string[] = [];
        const data: Record<string, string> = {};

        parsed.forEach((item: unknown, index: number) => {
            const itemNum = index + 1;
            if (item && typeof item === 'object') {
                const itemObj = item as Record<string, unknown>;
                fieldNames.forEach(field => {
                    const colName = `${columnPrefix}_${itemNum}_${field}`;
                    if (!columns.includes(colName)) {
                        columns.push(colName);
                    }
                    const value = itemObj[field];
                    // Convert value to string
                    if (value === null || value === undefined) {
                        data[colName] = '';
                    } else if (typeof value === 'object') {
                        data[colName] = JSON.stringify(value);
                    } else {
                        data[colName] = String(value);
                    }
                });
            }
        });

        // Sort columns to group by item number
        columns.sort((a, b) => {
            const numA = parseInt(a.split('_')[1]) || 0;
            const numB = parseInt(b.split('_')[1]) || 0;
            if (numA !== numB) return numA - numB;
            return a.localeCompare(b);
        });

        return { columns, data };
    } catch {
        return null;
    }
}

/**
 * Fix unescaped newlines inside JSON string values
 * AI often outputs actual line breaks instead of \n escape sequences
 */
function fixUnescapedNewlinesInJson(jsonStr: string): string {
    let result = '';
    let inString = false;
    let escape = false;

    for (let i = 0; i < jsonStr.length; i++) {
        const char = jsonStr[i];
        const nextChar = jsonStr[i + 1];

        if (escape) {
            // Previous char was backslash, this char is escaped
            result += char;
            escape = false;
            continue;
        }

        if (char === '\\') {
            escape = true;
            result += char;
            continue;
        }

        if (char === '"' && !escape) {
            inString = !inString;
            result += char;
            continue;
        }

        if (inString && (char === '\n' || char === '\r')) {
            // Replace actual newlines with escaped version inside strings
            if (char === '\r' && nextChar === '\n') {
                result += '\\n';
                i++; // Skip the \n that follows \r
            } else {
                result += '\\n';
            }
            continue;
        }

        result += char;
    }

    return result;
}

/**
 * Check if a string looks like it could be a JSON array response
 */
export function looksLikeJsonArray(response: string): boolean {
    const cleaned = response.trim();
    // Check for markdown-wrapped JSON
    if (cleaned.startsWith('```json') || cleaned.startsWith('```')) {
        const unwrapped = cleaned.replace(/^```(json)?/, '').replace(/```$/, '').trim();
        return unwrapped.startsWith('[');
    }
    return cleaned.startsWith('[');
}

// Initialize settings on load
loadAISettings();
