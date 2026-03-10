// Reoon Email Verifier Service
// Integrates with Reoon API for email verification
// Supports both single verification and bulk verification APIs

export interface ReoonSettings {
    apiKey: string;
    verificationMode: 'quick' | 'power';
}

// Verification result from single API
export interface ReoonVerificationResult {
    email: string;
    status: 'safe' | 'valid' | 'invalid' | 'disabled' | 'disposable' | 'inbox_full' | 'catch_all' | 'role_account' | 'spamtrap' | 'unknown';
    overall_score?: number;
    username?: string;
    domain?: string;
    is_safe_to_send?: boolean;
    is_valid_syntax?: boolean;
    is_disposable?: boolean;
    is_role_account?: boolean;
    can_connect_smtp?: boolean;
    has_inbox_full?: boolean;
    is_catch_all?: boolean;
    is_deliverable?: boolean;
    is_disabled?: boolean;
    is_spamtrap?: boolean;
    is_free_email?: boolean;
    mx_accepts_mail?: boolean;
    mx_records?: string[];
    verification_mode?: string;
}

// Account balance response
export interface ReoonAccountBalance {
    api_status: string;
    remaining_daily_credits: number;
    remaining_instant_credits: number;
    status: string;
}

// Bulk task creation response
export interface ReoonBulkTaskResponse {
    status: 'success' | 'error';
    task_id?: number;
    count_submitted?: number;
    count_duplicates_removed?: number;
    count_rejected_emails?: number;
    count_processing?: number;
    reason?: string;
}

// Bulk task result response
export interface ReoonBulkResultResponse {
    task_id: string;
    name: string;
    status: 'waiting' | 'running' | 'completed' | 'file_not_found' | 'file_loading_error' | string;
    count_total: number;
    count_checked: number;
    progress_percentage: number;
    results?: Record<string, ReoonVerificationResult>;
}

// Global processing state for background verification
export const reoonProcessingState = {
    isProcessing: false,
    mode: 'bulk' as 'single' | 'bulk',
    processedCount: 0,
    totalCount: 0,
    taskId: null as number | null,
    abortController: null as AbortController | null,
    listeners: new Set<() => void>(),

    start(totalCount: number, mode: 'single' | 'bulk' = 'bulk'): AbortController {
        const controller = new AbortController();
        this.isProcessing = true;
        this.mode = mode;
        this.processedCount = 0;
        this.totalCount = totalCount;
        this.taskId = null;
        this.abortController = controller;
        this.notify();
        return controller;
    },

    setTaskId(taskId: number) {
        this.taskId = taskId;
        this.notify();
    },

    update(processedCount: number) {
        this.processedCount = processedCount;
        this.notify();
    },

    cancel() {
        this.abortController?.abort();
        this.finish();
    },

    finish() {
        this.isProcessing = false;
        this.abortController = null;
        this.taskId = null;
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

// Settings persistence
const STORAGE_KEY = 'layerforge_reoon_settings';

let currentSettings: ReoonSettings = {
    apiKey: '',
    verificationMode: 'power'
};

export function loadReoonSettings(): ReoonSettings {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            currentSettings = JSON.parse(saved);
        }
    } catch (e) {
        console.error('Failed to load Reoon settings:', e);
    }
    return currentSettings;
}

export function saveReoonSettings(settings: Partial<ReoonSettings>) {
    currentSettings = { ...currentSettings, ...settings };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
    } catch (e) {
        console.error('Failed to save Reoon settings:', e);
    }
}

export function getReoonSettings(): ReoonSettings {
    return currentSettings;
}

export function clearReoonSettings() {
    currentSettings = { apiKey: '', verificationMode: 'power' };
    localStorage.removeItem(STORAGE_KEY);
}

// API Base URL - direct API call (Reoon API supports CORS)
const API_BASE = 'https://emailverifier.reoon.com/api/v1';

// Check account balance
export async function checkAccountBalance(): Promise<ReoonAccountBalance> {
    const { apiKey } = getReoonSettings();

    if (!apiKey) {
        throw new Error('Reoon API key not configured');
    }

    const response = await fetch(`${API_BASE}/check-account-balance/?key=${apiKey}`);

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to check balance: ${error}`);
    }

    return await response.json();
}

// Single email verification
export async function verifySingleEmail(
    email: string,
    mode?: 'quick' | 'power',
    signal?: AbortSignal
): Promise<ReoonVerificationResult> {
    const settings = getReoonSettings();
    const verifyMode = mode || settings.verificationMode;

    if (!settings.apiKey) {
        throw new Error('Reoon API key not configured');
    }

    const url = `${API_BASE}/verify?email=${encodeURIComponent(email)}&key=${settings.apiKey}&mode=${verifyMode}`;

    const response = await fetch(url, { signal });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Verification failed: ${error}`);
    }

    return await response.json();
}

// Bulk verification - Step 1: Create task
export async function createBulkVerificationTask(
    emails: string[],
    taskName?: string
): Promise<ReoonBulkTaskResponse> {
    const { apiKey } = getReoonSettings();

    if (!apiKey) {
        throw new Error('Reoon API key not configured');
    }

    if (emails.length < 10) {
        throw new Error('Bulk verification requires at least 10 emails. Use single verification for smaller lists.');
    }

    if (emails.length > 50000) {
        throw new Error('Maximum 50,000 emails per bulk task');
    }

    const response = await fetch(`${API_BASE}/create-bulk-verification-task/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: taskName || `LayerForge Bulk ${new Date().toISOString().slice(0, 16)}`,
            emails: emails,
            key: apiKey
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create bulk task: ${error}`);
    }

    return await response.json();
}

// Bulk verification - Step 2: Get results
export async function getBulkVerificationResults(taskId: number): Promise<ReoonBulkResultResponse> {
    const { apiKey } = getReoonSettings();

    if (!apiKey) {
        throw new Error('Reoon API key not configured');
    }

    const response = await fetch(`${API_BASE}/get-result-bulk-verification-task/?key=${apiKey}&task_id=${taskId}`);

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to get bulk results: ${error}`);
    }

    return await response.json();
}

// Verify multiple emails using single API with concurrency
export async function verifyEmailsSingle(
    emails: string[],
    onProgress?: (processed: number, total: number) => void,
    concurrency: number = 3,
    signal?: AbortSignal
): Promise<Map<string, ReoonVerificationResult>> {
    const results = new Map<string, ReoonVerificationResult>();
    let processed = 0;

    // Process in batches for controlled concurrency
    for (let i = 0; i < emails.length; i += concurrency) {
        if (signal?.aborted) break;

        const batch = emails.slice(i, i + concurrency);
        const batchPromises = batch.map(async (email) => {
            try {
                const result = await verifySingleEmail(email, undefined, signal);
                results.set(email, result);
            } catch (error) {
                if ((error as Error).name === 'AbortError') throw error;
                // Mark as unknown on error
                results.set(email, {
                    email,
                    status: 'unknown',
                    is_valid_syntax: false
                });
            }
            processed++;
            onProgress?.(processed, emails.length);
        });

        await Promise.all(batchPromises);

        // Small delay between batches to respect rate limits
        if (i + concurrency < emails.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }

    return results;
}

// Verify multiple emails using bulk API (recommended for 10+ emails)
export async function verifyEmailsBulk(
    emails: string[],
    onProgress?: (processed: number, total: number, status: string) => void,
    pollIntervalMs: number = 3000,
    signal?: AbortSignal
): Promise<Map<string, ReoonVerificationResult>> {
    // Create the bulk task
    onProgress?.(0, emails.length, 'Creating verification task...');
    const taskResponse = await createBulkVerificationTask(emails);

    if (taskResponse.status === 'error') {
        throw new Error(taskResponse.reason || 'Failed to create bulk task');
    }

    const taskId = taskResponse.task_id!;
    reoonProcessingState.setTaskId(taskId);

    onProgress?.(0, emails.length, `Task created (ID: ${taskId}). Waiting for verification...`);

    // Poll for results
    while (true) {
        if (signal?.aborted) {
            throw new Error('Verification cancelled');
        }

        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

        const resultResponse = await getBulkVerificationResults(taskId);

        const checked = resultResponse.count_checked;
        const total = resultResponse.count_total;
        const status = resultResponse.status;

        reoonProcessingState.update(checked);
        onProgress?.(checked, total, `Status: ${status} (${resultResponse.progress_percentage.toFixed(1)}%)`);

        if (status === 'completed' && resultResponse.results) {
            // Convert results object to Map
            const resultsMap = new Map<string, ReoonVerificationResult>();
            for (const [email, data] of Object.entries(resultResponse.results)) {
                resultsMap.set(email, data);
            }
            return resultsMap;
        }

        if (status === 'file_not_found' || status === 'file_loading_error') {
            throw new Error(`Bulk verification failed: ${status}`);
        }
    }
}

// Main entry point - automatically choose single or bulk based on count
export async function verifyEmails(
    emails: string[],
    options: {
        mode?: 'auto' | 'single' | 'bulk';
        onProgress?: (processed: number, total: number, status?: string) => void;
        signal?: AbortSignal;
    } = {}
): Promise<Map<string, ReoonVerificationResult>> {
    const { mode = 'auto', onProgress, signal } = options;

    // Filter out empty emails
    const validEmails = emails.filter(e => e && e.trim());

    if (validEmails.length === 0) {
        return new Map();
    }

    // Determine which API to use
    const useBulk = mode === 'bulk' || (mode === 'auto' && validEmails.length >= 10);

    if (useBulk && validEmails.length >= 10) {
        return verifyEmailsBulk(validEmails, onProgress, 3000, signal);
    } else {
        return verifyEmailsSingle(validEmails,
            (p, t) => onProgress?.(p, t, `Verifying ${p}/${t}...`),
            3,
            signal
        );
    }
}

// Helper to detect email columns in CSV data
export function detectEmailColumn(headers: string[], data: Record<string, string>[]): string | null {
    const emailKeywords = ['email', 'e-mail', 'mail', 'contact'];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // First try to find by header name
    for (const header of headers) {
        const lowerHeader = header.toLowerCase();
        if (emailKeywords.some(kw => lowerHeader.includes(kw))) {
            // Verify it contains email-like values
            const sampleValues = data.slice(0, 5).map(row => row[header] || '');
            if (sampleValues.some(v => emailRegex.test(v))) {
                return header;
            }
        }
    }

    // Then try to find by content
    for (const header of headers) {
        const sampleValues = data.slice(0, 10).map(row => row[header] || '');
        const emailCount = sampleValues.filter(v => emailRegex.test(v)).length;
        if (emailCount >= 3) {
            return header;
        }
    }

    return null;
}

// Extract emails from a column
export function extractEmails(data: Record<string, string>[], columnName: string): string[] {
    return data
        .map(row => row[columnName] || '')
        .filter(val => val.trim() !== '')
        .map(val => val.trim().toLowerCase());
}

// Get status badge color
export function getStatusColor(status: string): string {
    switch (status) {
        case 'safe':
        case 'valid':
            return 'bg-green-500';
        case 'invalid':
        case 'disabled':
            return 'bg-red-500';
        case 'disposable':
        case 'spamtrap':
            return 'bg-orange-500';
        case 'catch_all':
        case 'role_account':
            return 'bg-yellow-500';
        case 'inbox_full':
            return 'bg-blue-500';
        default:
            return 'bg-gray-500';
    }
}

// Get human-readable status
export function getStatusLabel(status: string): string {
    switch (status) {
        case 'safe': return '✓ Safe';
        case 'valid': return '✓ Valid';
        case 'invalid': return '✗ Invalid';
        case 'disabled': return '✗ Disabled';
        case 'disposable': return '⚠ Disposable';
        case 'spamtrap': return '⚠ Spam Trap';
        case 'catch_all': return '~ Catch-All';
        case 'role_account': return '~ Role Account';
        case 'inbox_full': return '~ Inbox Full';
        case 'unknown': return '? Unknown';
        default: return status;
    }
}

// Column name for verification results
export const REOON_RESULT_COLUMN = '__email_verification';
export const REOON_RESULT_DISPLAY = '✉️ Email Status';

// Check if column is a Reoon result column
export function isReoonColumn(columnName: string): boolean {
    return columnName === REOON_RESULT_COLUMN;
}

// Initialize settings on module load
loadReoonSettings();
