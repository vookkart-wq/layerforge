// Apify Scraper Service
// Integrates with Apify API to run actors and fetch results
import { getSyncedItem, setSyncedItem, removeSyncedItem } from '@/lib/syncedStorage';

export interface ApifySettings {
    apiToken: string;
}

export interface ApifyActorPreset {
    id: string;
    name: string;
    description: string;
    defaultInput?: Record<string, unknown>;
}

// Custom actor preset with template and matching config
export interface CustomActorPreset extends ApifyActorPreset {
    inputTemplate?: string;       // JSON with {{column_name}} placeholders
    matchResultField?: string;    // Field in results to match on (e.g., "profileUrl")
    isCustom: true;
}

// Pending results type for post-run mapping
export interface PendingApifyResults {
    items: Record<string, unknown>[];
    actorId: string;
    actorName: string;
    enrichColumnName: string;
    enrichDisplayName: string;
    rowIndices: number[];
    enrichedCount: number;
}

// Global processing state for background Apify runs
export const apifyProcessingState = {
    isProcessing: false,
    actorId: '',
    actorName: '',
    processedCount: 0,
    totalCount: 0,
    failedIds: new Set<string>(),
    abortController: null as AbortController | null,
    listeners: new Set<() => void>(),
    pendingResults: null as PendingApifyResults | null,

    start(actorId: string, actorName: string, totalCount: number): AbortController {
        const controller = new AbortController();
        this.isProcessing = true;
        this.actorId = actorId;
        this.actorName = actorName;
        this.processedCount = 0;
        this.totalCount = totalCount;
        this.failedIds = new Set();
        this.abortController = controller;
        this.pendingResults = null;
        this.notify();
        return controller;
    },

    update(processedCount: number) {
        this.processedCount = processedCount;
        this.notify();
    },

    addFailed(id: string) {
        this.failedIds.add(id);
        this.notify();
    },

    cancel() {
        this.abortController?.abort();
        this.finish();
    },

    finish() {
        this.isProcessing = false;
        this.abortController = null;
        this.notify();
    },

    storePendingResults(data: PendingApifyResults | null) {
        this.pendingResults = data;
        this.notify();
    },

    clearPendingResults() {
        this.pendingResults = null;
        this.notify();
    },

    notify() {
        this.listeners.forEach(fn => fn());
    },

    subscribe(fn: () => void) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
};
// Enrichment column prefix for per-scraper columns
export const ENRICHED_COLUMN_PREFIX = '__enrich_';

// Get the enrichment column name for a specific actor
export function getEnrichmentColumnName(actorId: string): string {
    // Convert actor ID to valid column name (e.g., "apimaestro/linkedin-profile" -> "__enrich_linkedin_profile")
    const simpleName = actorId.split('/').pop()?.replace(/-/g, '_').toLowerCase() || 'unknown';
    return `${ENRICHED_COLUMN_PREFIX}${simpleName}`;
}

// Get a nice display name for enrichment column
export function getEnrichmentDisplayName(actorId: string): string {
    const preset = APIFY_PRESETS.find(p => p.id === actorId);
    if (preset) {
        if (actorId.includes('linkedin-profile')) return '🔗 LinkedIn Profile';
        if (actorId.includes('linkedin-company')) return '🏢 LinkedIn Company';
        return `📊 ${preset.name}`;
    }
    return `📊 ${actorId.split('/').pop() || 'Enrichment'}`;
}

// Check if a column is an enrichment column
export function isEnrichmentColumn(columnName: string): boolean {
    return columnName.startsWith(ENRICHED_COLUMN_PREFIX);
}

// Get actor ID from enrichment column name
export function getActorIdFromColumn(columnName: string): string | null {
    if (!isEnrichmentColumn(columnName)) return null;
    const simpleName = columnName.replace(ENRICHED_COLUMN_PREFIX, '');
    // Find matching preset
    const preset = APIFY_PRESETS.find(p =>
        p.id.split('/').pop()?.replace(/-/g, '_').toLowerCase() === simpleName
    );
    return preset?.id || null;
}

// Interface for stored enrichment data
export interface EnrichmentData {
    source: string;  // Actor ID
    sourceName: string;  // Actor display name
    scrapedAt: string;  // ISO timestamp
    matchedBy: string;  // The ID value used to match (e.g., LinkedIn URL)
    data: Record<string, unknown>;  // All scraped data
}

// Legacy: Keep for backward compatibility
export const ENRICHED_COLUMN_NAME = '__enriched';

// Check if a row has enrichment data
export function hasEnrichment(row: Record<string, string>): boolean {
    const val = row[ENRICHED_COLUMN_NAME];
    if (!val) return false;
    try {
        const parsed = JSON.parse(val);
        return parsed && typeof parsed.data === 'object';
    } catch {
        return false;
    }
}

// Check if a row has enrichment from a specific source/actor (uses per-scraper column)
export function hasEnrichmentFromSource(row: Record<string, string>, actorId: string): boolean {
    const columnName = getEnrichmentColumnName(actorId);
    const val = row[columnName];
    if (!val) return false;
    try {
        const parsed = JSON.parse(val);
        return parsed && typeof parsed.data === 'object';
    } catch {
        return false;
    }
}

// Get enrichment data from a specific column
export function getEnrichmentFromColumn(row: Record<string, string>, columnName: string): EnrichmentData | null {
    const val = row[columnName];
    if (!val) return null;
    try {
        return JSON.parse(val) as EnrichmentData;
    } catch {
        return null;
    }
}

// Get enrichment data from a row
export function getEnrichment(row: Record<string, string>): EnrichmentData | null {
    const val = row[ENRICHED_COLUMN_NAME];
    if (!val) return null;
    try {
        return JSON.parse(val) as EnrichmentData;
    } catch {
        return null;
    }
}

// Get all available field paths from enrichment data
// Now supports full array navigation with indices (e.g., experience[0].title, experience[1].title)
export function getEnrichmentFields(enrichment: EnrichmentData): string[] {
    const paths: string[] = [];
    const visited = new Set<string>(); // Avoid duplicate paths

    function addPath(path: string) {
        if (!visited.has(path)) {
            visited.add(path);
            paths.push(path);
        }
    }

    function collectPaths(obj: unknown, prefix: string, depth: number = 0): void {
        // Limit depth to prevent infinite recursion on very deep/circular structures
        if (depth > 10 || obj === null || obj === undefined) return;

        if (Array.isArray(obj)) {
            // Add the array path itself (for accessing as comma-joined string)
            if (prefix) addPath(prefix);

            // Iterate through ALL items in the array, not just first
            obj.forEach((item, index) => {
                const indexedPath = `${prefix}[${index}]`;

                if (item !== null && typeof item === 'object') {
                    // Recurse into object items with indexed path
                    collectPaths(item, indexedPath, depth + 1);
                } else if (item !== null && item !== undefined) {
                    // Primitive array items - add the indexed path
                    addPath(indexedPath);
                }
            });
            return;
        }

        if (typeof obj === 'object') {
            for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
                const newPath = prefix ? `${prefix}.${key}` : key;

                if (value !== null && typeof value === 'object') {
                    // Recurse into nested objects/arrays
                    collectPaths(value, newPath, depth + 1);
                } else if (value !== null && value !== undefined) {
                    // Leaf value - add the path
                    addPath(newPath);
                }
            }
        }
    }

    collectPaths(enrichment.data, '', 0);
    return paths.sort();
}

// Get a nested value from enrichment data by path
// Supports: "location.city", "experience[0].title", "education[1].school", etc.
export function getEnrichmentValue(enrichment: EnrichmentData, path: string): unknown {
    // Parse the path to handle both dot notation and bracket notation
    // e.g., "experience[0].title" -> ["experience", "0", "title"]
    const parts: string[] = [];
    let currentPart = '';
    let inBracket = false;

    for (let i = 0; i < path.length; i++) {
        const char = path[i];
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

    let current: unknown = enrichment.data;

    for (const part of parts) {
        if (current === null || current === undefined) return undefined;

        if (Array.isArray(current)) {
            // Check if part is an integer index (e.g. "0", "1")
            const index = parseInt(part, 10);
            if (!isNaN(index) && String(index) === part) {
                current = current[index];
                continue;
            }

            // Otherwise, map property over array items (backward compatibility)
            const values = current.map(item => {
                if (item && typeof item === 'object') {
                    return (item as Record<string, unknown>)[part];
                }
                return undefined;
            }).filter(v => v !== undefined);
            return values.length === 1 ? values[0] : values.join(', ');
        }

        if (typeof current === 'object') {
            current = (current as Record<string, unknown>)[part];
        } else {
            return undefined;
        }
    }

    // Stringify if object/array
    if (current !== null && typeof current === 'object') {
        return JSON.stringify(current);
    }
    return current;
}

// Preset actors for common scraping tasks
export const APIFY_PRESETS: ApifyActorPreset[] = [
    {
        id: 'apimaestro/linkedin-profile-batch-scraper-no-cookies-required',
        name: 'LinkedIn Profile Scraper (No Cookies)',
        description: 'Scrape LinkedIn profiles in batch - no cookies required. Up to 500 profiles.',
        defaultInput: {
            includeEmail: true,
            usernames: []  // Will be populated from CSV
        }
    },
    {
        id: 'harvestapi/linkedin-company',
        name: 'LinkedIn Company Scraper',
        description: 'Scrape LinkedIn company pages - get company info, employees, jobs.',
        defaultInput: {
            companies: []  // Will be populated from CSV
        }
    },
    {
        id: 'apify/web-scraper',
        name: 'Web Scraper',
        description: 'Scrape any website with custom selectors'
    },
    {
        id: 'apify/google-search-scraper',
        name: 'Google Search Scraper',
        description: 'Scrape Google search results'
    },
    {
        id: 'apify/instagram-scraper',
        name: 'Instagram Scraper',
        description: 'Scrape Instagram profiles and posts'
    },
    {
        id: 'apify/twitter-scraper',
        name: 'Twitter/X Scraper',
        description: 'Scrape Twitter/X profiles and tweets'
    }
];

// Helper to detect if a column contains LinkedIn URLs/usernames
export function detectLinkedInColumn(headers: string[], data: Record<string, string>[]): string | null {
    const linkedInKeywords = ['linkedin', 'profile', 'url'];

    // First try to find by header name
    for (const header of headers) {
        const lowerHeader = header.toLowerCase();
        if (linkedInKeywords.some(kw => lowerHeader.includes(kw))) {
            // Verify it contains LinkedIn-like values
            const sampleValues = data.slice(0, 5).map(row => row[header] || '');
            if (sampleValues.some(v => v.includes('linkedin') || v.includes('/in/'))) {
                return header;
            }
        }
    }

    // Then try to find by content
    for (const header of headers) {
        const sampleValues = data.slice(0, 10).map(row => row[header] || '');
        const linkedInCount = sampleValues.filter(v => v.includes('linkedin.com/in/')).length;
        if (linkedInCount >= 3) {
            return header;
        }
    }

    return null;
}

// Extract LinkedIn usernames/URLs from a CSV column
export function extractLinkedInUsernames(data: Record<string, string>[], columnName: string): string[] {
    return data
        .map(row => row[columnName] || '')
        .filter(val => val.trim() !== '')
        .map(val => val.trim());
}

// Helper to detect if a column contains LinkedIn Company URLs
export function detectLinkedInCompanyColumn(headers: string[], data: Record<string, string>[]): string | null {
    const companyKeywords = ['linkedin', 'company', 'company_url', 'companyurl', 'organization'];

    // First try to find by header name
    for (const header of headers) {
        const lowerHeader = header.toLowerCase();
        if (companyKeywords.some(kw => lowerHeader.includes(kw))) {
            const sampleValues = data.slice(0, 5).map(row => row[header] || '');
            if (sampleValues.some(v => v.includes('linkedin.com/company/'))) {
                return header;
            }
        }
    }

    // Then try to find by content
    for (const header of headers) {
        const sampleValues = data.slice(0, 10).map(row => row[header] || '');
        const companyCount = sampleValues.filter(v => v.includes('linkedin.com/company/')).length;
        if (companyCount >= 3) {
            return header;
        }
    }

    return null;
}

// Extract LinkedIn Company URLs from a CSV column
export function extractLinkedInCompanyUrls(data: Record<string, string>[], columnName: string): string[] {
    return data
        .map(row => row[columnName] || '')
        .filter(val => val.trim() !== '')
        .map(val => val.trim());
}

// Recommended output columns from LinkedIn Profile scraper
export const LINKEDIN_RECOMMENDED_COLUMNS = [
    'fullName',
    'headline',
    'currentCompany',
    'location',
    'followerCount',
    'email',
    'phone',
    'about',
    'skills'
];

// Recommended output columns from LinkedIn Company scraper
export const LINKEDIN_COMPANY_RECOMMENDED_COLUMNS = [
    'name',
    'tagline',
    'description',
    'website',
    'industry',
    'companySize',
    'headquarters',
    'foundedYear',
    'followerCount',
    'employeeCount',
    'specialties',
    'linkedInUrl'
];

// Settings persistence
const STORAGE_KEY = 'layerforge_apify_settings';

let currentSettings: ApifySettings = {
    apiToken: ''
};

export function loadApifySettings(): ApifySettings {
    try {
        const saved = getSyncedItem(STORAGE_KEY);
        if (saved) {
            currentSettings = JSON.parse(saved);
        }
    } catch (e) {
        console.error('Failed to load Apify settings:', e);
    }
    return currentSettings;
}

export function saveApifySettings(settings: Partial<ApifySettings>) {
    currentSettings = { ...currentSettings, ...settings };
    try {
        setSyncedItem(STORAGE_KEY, JSON.stringify(currentSettings));
    } catch (e) {
        console.error('Failed to save Apify settings:', e);
    }
}

export function getApifySettings(): ApifySettings {
    return currentSettings;
}

export function clearApifySettings() {
    currentSettings = { apiToken: '' };
    removeSyncedItem(STORAGE_KEY);
}

// API Base URL - goes through Vite proxy to avoid CORS
const API_BASE = 'https://api.apify.com/v2';

interface ApifyRunResult {
    id: string;
    status: string;
    defaultDatasetId: string;
}

interface ApifyDatasetItem {
    [key: string]: unknown;
}

// Run an Apify actor and wait for completion
export async function runApifyActor(
    actorId: string,
    input: Record<string, unknown>,
    onProgress?: (status: string) => void
): Promise<ApifyDatasetItem[]> {
    const { apiToken } = getApifySettings();

    if (!apiToken) {
        throw new Error('Apify API token not configured');
    }

    // Start the actor run
    onProgress?.('Starting actor...');

    const runResponse = await fetch(`${API_BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${apiToken}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(input)
    });

    if (!runResponse.ok) {
        const error = await runResponse.text();
        throw new Error(`Failed to start actor: ${error}`);
    }

    const runData = await runResponse.json();
    const runId = runData.data.id;

    // Poll for completion
    onProgress?.('Running...');
    let status = 'RUNNING';
    let datasetId = '';

    while (status === 'RUNNING' || status === 'READY') {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

        const statusResponse = await fetch(`${API_BASE}/actor-runs/${runId}?token=${apiToken}`);
        if (!statusResponse.ok) {
            throw new Error('Failed to check run status');
        }

        const statusData = await statusResponse.json();
        status = statusData.data.status;
        datasetId = statusData.data.defaultDatasetId;

        onProgress?.(`Status: ${status}`);

        if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
            throw new Error(`Actor run ${status.toLowerCase()}`);
        }
    }

    // Fetch the dataset
    onProgress?.('Fetching results...');

    const datasetResponse = await fetch(`${API_BASE}/datasets/${datasetId}/items?token=${apiToken}`);
    if (!datasetResponse.ok) {
        throw new Error('Failed to fetch dataset');
    }

    const items: ApifyDatasetItem[] = await datasetResponse.json();

    onProgress?.(`Got ${items.length} results`);

    return items;
}

// Flatten a nested object into dot-notation paths
// e.g., {location: {city: "Madrid"}} -> {"location.city": "Madrid"}
// Also extracts keys from arrays: {education: [{school: "X"}]} -> {"education.school": "X"}
export function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const key of Object.keys(obj)) {
        const value = obj[key];
        const newKey = prefix ? `${prefix}.${key}` : key;

        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            // Recursively flatten nested objects
            const nested = flattenObject(value as Record<string, unknown>, newKey);
            Object.assign(result, nested);
        } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
            // For arrays of objects, extract all unique keys from all items
            value.forEach(item => {
                if (item && typeof item === 'object') {
                    const nested = flattenObject(item as Record<string, unknown>, newKey);
                    // Only add if not already present
                    Object.entries(nested).forEach(([k, v]) => {
                        if (!(k in result)) {
                            result[k] = v;
                        }
                    });
                }
            });
        } else {
            result[newKey] = value;
        }
    }

    return result;
}

// Flatten all items in a dataset
export function flattenDatasetItems(items: ApifyDatasetItem[]): ApifyDatasetItem[] {
    return items.map(item => flattenObject(item as Record<string, unknown>));
}

// Get unique keys from dataset items (with flattening)
export function getDatasetColumns(items: ApifyDatasetItem[], flatten = true): string[] {
    const keys = new Set<string>();

    items.forEach(item => {
        if (flatten) {
            const flattened = flattenObject(item as Record<string, unknown>);
            Object.keys(flattened).forEach(key => keys.add(key));
        } else {
            Object.keys(item).forEach(key => keys.add(key));
        }
    });

    return Array.from(keys).sort();
}

// Get a value from a flattened path (e.g., "location.city")
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return undefined;
        }
        current = (current as Record<string, unknown>)[part];
    }

    return current;
}

// ─── Custom Actor Presets ───────────────────────────────────────

const CUSTOM_PRESETS_KEY = 'layerforge_custom_apify_presets';

export function loadCustomPresets(): CustomActorPreset[] {
    try {
        const saved = getSyncedItem(CUSTOM_PRESETS_KEY);
        return saved ? JSON.parse(saved) : [];
    } catch {
        return [];
    }
}

export function saveCustomPreset(preset: CustomActorPreset): void {
    const presets = loadCustomPresets();
    const existingIndex = presets.findIndex(p => p.id === preset.id);
    if (existingIndex >= 0) {
        presets[existingIndex] = preset;
    } else {
        presets.push(preset);
    }
    setSyncedItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
}

export function deleteCustomPreset(id: string): void {
    const presets = loadCustomPresets().filter(p => p.id !== id);
    setSyncedItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
}

export function getAllPresets(): (ApifyActorPreset & { isCustom?: true })[] {
    return [...APIFY_PRESETS, ...loadCustomPresets()];
}

// ─── Template Expansion ────────────────────────────────────────

export function getTemplatePlaceholders(template: string): string[] {
    const regex = /\{\{([^}]+)\}\}/g;
    const placeholders: string[] = [];
    let match;
    while ((match = regex.exec(template)) !== null) {
        const col = match[1].trim();
        if (!placeholders.includes(col)) {
            placeholders.push(col);
        }
    }
    return placeholders;
}

function expandNode(node: unknown, columnValues: Record<string, string[]>): unknown {
    if (typeof node === 'string') {
        const match = node.match(/^\{\{([^}]+)\}\}$/);
        if (match) {
            const col = match[1].trim();
            if (columnValues[col]) {
                return columnValues[col];
            }
        }
        return node;
    }

    if (Array.isArray(node)) {
        const expanded: unknown[] = [];
        for (const item of node) {
            if (typeof item === 'string') {
                const match = item.match(/^\{\{([^}]+)\}\}$/);
                if (match) {
                    const col = match[1].trim();
                    if (columnValues[col]) {
                        expanded.push(...columnValues[col]);
                        continue;
                    }
                }
            }
            expanded.push(expandNode(item, columnValues));
        }
        return expanded;
    }

    if (node !== null && typeof node === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            result[key] = expandNode(value, columnValues);
        }
        return result;
    }

    return node;
}

export function expandTemplate(
    template: string,
    data: Record<string, string>[],
    rowIndices: number[]
): string {
    const placeholders = getTemplatePlaceholders(template);
    if (placeholders.length === 0) return template;

    const columnValues: Record<string, string[]> = {};
    for (const col of placeholders) {
        columnValues[col] = rowIndices
            .map(i => data[i]?.[col] || '')
            .filter(v => v.trim() !== '');
    }

    try {
        const parsed = JSON.parse(template);
        const expanded = expandNode(parsed, columnValues);
        return JSON.stringify(expanded, null, 2);
    } catch {
        // Fallback: simple string replacement
        let result = template;
        for (const col of placeholders) {
            result = result.replace(`"{{${col}}}"`, JSON.stringify(columnValues[col]));
        }
        return result;
    }
}

// ─── Configurable Result Matching ──────────────────────────────

function normalizeMatchValue(value: string): string {
    let normalized = value.toLowerCase().trim();
    normalized = normalized.replace(/^https?:\/\//, '');
    normalized = normalized.replace(/^www\./, '');
    normalized = normalized.replace(/\/$/, '');
    normalized = normalized.replace(/^@/, '');
    return normalized;
}

export function matchResultsToRows(
    items: Record<string, unknown>[],
    data: Record<string, string>[],
    rowIndices: number[],
    matchResultField: string,
    matchCsvColumn: string
): Map<number, Record<string, unknown>> {
    const matches = new Map<number, Record<string, unknown>>();
    if (!matchResultField || !matchCsvColumn) return matches;

    for (const item of items) {
        const resultValue = getNestedValue(item, matchResultField);
        if (resultValue === null || resultValue === undefined) continue;

        const normalizedResult = normalizeMatchValue(String(resultValue));

        for (const rowIdx of rowIndices) {
            if (matches.has(rowIdx)) continue;
            const csvValue = data[rowIdx]?.[matchCsvColumn] || '';
            if (!csvValue.trim()) continue;

            const normalizedCsv = normalizeMatchValue(csvValue);

            if (normalizedResult && normalizedCsv &&
                (normalizedResult.includes(normalizedCsv) || normalizedCsv.includes(normalizedResult))) {
                matches.set(rowIdx, item);
                break;
            }
        }
    }

    return matches;
}

// Initialize settings on module load
loadApifySettings();
