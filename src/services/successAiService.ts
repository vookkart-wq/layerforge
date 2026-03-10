// Success.ai API Service
// API Documentation: https://api.success.ai/api/docs

const API_BASE = '/api/successai';
const CAMPAIGNS_CACHE_KEY = 'successai_campaigns_cache';
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// Settings persistence
export function getSuccessAiSettings() {
    return {
        apiKey: localStorage.getItem('successai_api_key') || '',
        isValidated: localStorage.getItem('successai_key_validated') === 'true',
        workspaceName: localStorage.getItem('successai_workspace_name') || ''
    };
}

export function saveSuccessAiSettings(apiKey: string, workspaceName?: string) {
    localStorage.setItem('successai_api_key', apiKey);
    if (workspaceName !== undefined) {
        localStorage.setItem('successai_workspace_name', workspaceName);
        localStorage.setItem('successai_key_validated', 'true');
    }
}

export function clearSuccessAiValidation() {
    localStorage.removeItem('successai_key_validated');
    localStorage.removeItem('successai_workspace_name');
    clearCampaignCache();
}

// Campaign cache
export function getCachedCampaigns(): { campaigns: SuccessAiCampaign[]; expired: boolean } | null {
    try {
        const cached = localStorage.getItem(CAMPAIGNS_CACHE_KEY);
        if (!cached) return null;

        const parsed = JSON.parse(cached);
        const { campaigns, timestamp } = parsed;

        // Validate data structure
        if (!Array.isArray(campaigns) || typeof timestamp !== 'number') {
            clearCampaignCache();
            return null;
        }

        const expired = Date.now() - timestamp > CACHE_EXPIRY_MS;
        return { campaigns, expired };
    } catch {
        // Clear invalid cache
        clearCampaignCache();
        return null;
    }
}

export function saveCampaignsToCache(campaigns: SuccessAiCampaign[]) {
    localStorage.setItem(CAMPAIGNS_CACHE_KEY, JSON.stringify({
        campaigns,
        timestamp: Date.now()
    }));
}

export function clearCampaignCache() {
    localStorage.removeItem(CAMPAIGNS_CACHE_KEY);
}

// Types
export interface SuccessAiCampaign {
    campaignId: string;
    campaignName: string;
}

export interface SuccessAiContact {
    email: string;
    firstName?: string;
    lastName?: string;
    companyName?: string;
    location?: string;
    website?: string;
    iceBreaker?: string;
    customVariables?: Record<string, string>;
}

export interface AddContactsResponse {
    status: string;
    totalSent: number;
    contactsUploaded: number;
    alreadyInCampaign: number | null;
    invalidEmailCount: number | null;
    duplicateEmailCount: number | null;
    remainingInPlan: number;
}

// API Functions

/**
 * Test API key validity
 */
export async function authenticate(apiKey: string): Promise<{ valid: boolean; workspaceName?: string; error?: string }> {
    try {
        const response = await fetch(`${API_BASE}/v1/authenticate?apiKey=${encodeURIComponent(apiKey)}`);

        if (response.ok) {
            const data = await response.json();
            return { valid: true, workspaceName: data.workspaceName };
        } else if (response.status === 401) {
            return { valid: false, error: 'Invalid API key' };
        } else {
            return { valid: false, error: `Authentication failed: ${response.statusText}` };
        }
    } catch (error) {
        return { valid: false, error: error instanceof Error ? error.message : 'Network error' };
    }
}

/**
 * List all campaigns (with retry logic for rate limits)
 */
export async function listCampaigns(apiKey: string, skip = 0, limit = 50): Promise<{ campaigns: SuccessAiCampaign[]; error?: string }> {
    const MAX_RETRIES = 3;
    let lastError = '';

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const params = new URLSearchParams({
                apiKey,
                skip: String(skip),
                limit: String(limit)
            });

            const response = await fetch(`${API_BASE}/v1/campaign/list?${params}`);

            if (!response.ok) {
                const errorText = await response.text();
                const isRateLimit = response.status === 429 || errorText.toLowerCase().includes('too many');

                if (isRateLimit && attempt < MAX_RETRIES) {
                    const waitTime = 2000 * Math.pow(2, attempt); // 2s, 4s, 8s
                    // Rate limited, retrying...
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                // API error occurred
                return { campaigns: [], error: `Failed to fetch campaigns: ${response.statusText}` };
            }

            const data = await response.json();
            // Response received successfully

            // Handle different response formats from Success.ai
            let rawCampaigns = [];
            if (Array.isArray(data)) {
                rawCampaigns = data;
            } else if (data.campaigns && Array.isArray(data.campaigns)) {
                rawCampaigns = data.campaigns;
            } else if (data.data && Array.isArray(data.data)) {
                rawCampaigns = data.data;
            }

            // Normalize campaign objects
            const campaigns: SuccessAiCampaign[] = rawCampaigns.map((c: any) => ({
                campaignId: c._id || c.campaignId || c.id,
                campaignName: c.name || c.campaignName || 'Unnamed Campaign'
            }));

            return { campaigns };
        } catch (error) {
            lastError = error instanceof Error ? error.message : 'Network error';
            // Network error occurred

            if (attempt < MAX_RETRIES) {
                const waitTime = 2000 * Math.pow(2, attempt);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
        }
    }

    return { campaigns: [], error: lastError || 'Failed after retries' };
}

/**
 * Create a new campaign
 */
export async function createCampaign(apiKey: string, name: string, timezone = 'America/New_York'): Promise<{ campaignId?: string; error?: string }> {
    try {
        const response = await fetch(`${API_BASE}/v1/campaign/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, name, timezone })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return { error: errorData.message || `Failed to create campaign: ${response.statusText}` };
        }

        const data = await response.json();
        return { campaignId: data.campaignId };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Network error' };
    }
}

/**
 * Add contacts to a campaign (max 500 per request)
 */
export async function addContacts(
    apiKey: string,
    campaignId: string,
    contacts: SuccessAiContact[],
    skipIfInWorkspace = false,
    skipIfInCampaign = true
): Promise<AddContactsResponse & { error?: string }> {
    try {
        const response = await fetch(`${API_BASE}/v1/contact/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apiKey,
                campaignId,
                skipIfInWorkspace, // Reverted: API rejects plural "skipIfInWorkspaces" despite schema
                skipIfInCampaign,
                contacts
            })
        });

        // Request sent

        if (!response.ok) {
            const errorText = await response.text();
            try {
                const errorData = JSON.parse(errorText);
                return {
                    status: 'error',
                    totalSent: 0,
                    contactsUploaded: 0,
                    alreadyInCampaign: null,
                    invalidEmailCount: null,
                    duplicateEmailCount: null,
                    remainingInPlan: 0,
                    error: errorData.message || `Failed to add contacts: ${response.status} ${response.statusText}`
                };
            } catch (e) {
                // Error response received
                return {
                    status: 'error',
                    totalSent: 0,
                    contactsUploaded: 0,
                    alreadyInCampaign: null,
                    invalidEmailCount: null,
                    duplicateEmailCount: null,
                    remainingInPlan: 0,
                    error: `Failed to add contacts: ${response.status} ${response.statusText} - ${errorText.substring(0, 100)}`
                };
            }
        }

        const data = await response.json();

        return {
            status: 'success',
            totalSent: contacts.length,
            // Handle various possible response fields
            contactsUploaded: data.contactsUploaded ?? data.uploaded ?? data.count ?? data.created ?? contacts.length,
            alreadyInCampaign: data.alreadyInCampaign,
            invalidEmailCount: data.invalidEmailCount,
            duplicateEmailCount: data.duplicateEmailCount,
            remainingInPlan: data.remainingInPlan ?? 0
        };
    } catch (error) {
        return {
            status: 'error',
            totalSent: 0,
            contactsUploaded: 0,
            alreadyInCampaign: null,
            invalidEmailCount: null,
            duplicateEmailCount: null,
            remainingInPlan: 0,
            error: error instanceof Error ? error.message : 'Network error'
        };
    }
}

/**
 * Push contacts in batches (handles > 500 contacts)
 * Includes rate limit handling with exponential backoff
 * 
 * Note: Success.ai's API has a known bug where it may return 500 errors
 * even after successfully processing contacts. We track "possiblyUploaded"
 * to give users a more accurate picture of what may have been processed.
 */
export async function pushContactsInBatches(
    apiKey: string,
    campaignId: string,
    contacts: SuccessAiContact[],
    onProgress?: (uploaded: number, total: number) => void,
    abortSignal?: AbortSignal
): Promise<{
    confirmedUploaded: number;  // Contacts confirmed uploaded (200 response)
    possiblyUploaded: number;   // Contacts that may have uploaded despite 500 error
    totalSent: number;          // Total contacts sent to API
    errors: string[];
    remainingInPlan: number;
    batchResults: { batchNum: number; status: 'success' | 'error-may-have-uploaded' | 'error'; count: number; message?: string }[];
}> {
    const BATCH_SIZE = 500; // API allows max 500 contacts per request
    const BATCH_DELAY_MS = 1500; // Delay between batches to avoid rate limits
    const MAX_RETRIES = 3;
    const batches: SuccessAiContact[][] = [];

    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
        batches.push(contacts.slice(i, i + BATCH_SIZE));
    }

    let confirmedUploaded = 0;
    let possiblyUploaded = 0;
    let totalSent = 0;
    let remainingInPlan = 0;
    const errors: string[] = [];
    const batchResults: { batchNum: number; status: 'success' | 'error-may-have-uploaded' | 'error'; count: number; message?: string }[] = [];

    for (let i = 0; i < batches.length; i++) {
        if (abortSignal?.aborted) {
            errors.push('Cancelled by user');
            break;
        }

        const batch = batches[i];
        let result = await addContacts(apiKey, campaignId, batch);
        let retryCount = 0;

        // Retry logic for rate limit (429) ONLY
        while (result.error && retryCount < MAX_RETRIES) {
            const isRateLimit = result.error.includes('429') || result.error.toLowerCase().includes('too many');

            if (isRateLimit) {
                retryCount++;
                const waitTime = 2000 * Math.pow(2, retryCount - 1);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                result = await addContacts(apiKey, campaignId, batch);
            } else {
                break; // Don't retry 500 or other errors - they may have already processed
            }
        }

        if (result.error) {
            const is500Error = result.error.includes('500') || result.error.toLowerCase().includes('internal server');

            if (is500Error) {
                // 500 errors may have still processed the contacts (known Success.ai bug)
                possiblyUploaded += batch.length;
                batchResults.push({
                    batchNum: i + 1,
                    status: 'error-may-have-uploaded',
                    count: batch.length,
                    message: 'Server error - contacts may have been uploaded anyway'
                });
                errors.push(`Batch ${i + 1}: Server error (500) - ${batch.length} contacts may have uploaded anyway`);
            } else {
                batchResults.push({
                    batchNum: i + 1,
                    status: 'error',
                    count: 0,
                    message: result.error
                });
                errors.push(`Batch ${i + 1} (${batch[0].email}...): ${result.error}`);
            }
        } else {
            const uploaded = result.contactsUploaded || 0;
            confirmedUploaded += uploaded;
            totalSent += result.totalSent || 0;
            remainingInPlan = result.remainingInPlan || 0;
            batchResults.push({
                batchNum: i + 1,
                status: 'success',
                count: uploaded
            });
        }

        onProgress?.(Math.min(contacts.length, (i + 1) * BATCH_SIZE), contacts.length);

        // Wait between batches to avoid rate limits
        if (i < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
    }

    return { confirmedUploaded, possiblyUploaded, totalSent, errors, remainingInPlan, batchResults };
}

// Field mapping helper
export const SUCCESSAI_FIELDS = [
    { key: 'email', label: 'Email', required: true },
    { key: 'firstName', label: 'First Name', required: false },
    { key: 'lastName', label: 'Last Name', required: false },
    { key: 'companyName', label: 'Company Name', required: false },
    { key: 'location', label: 'Location', required: false },
    { key: 'website', label: 'Website', required: false },
    { key: 'iceBreaker', label: 'Ice Breaker', required: false }
];

/**
 * Map CSV row to Success.ai contact using field mapping
 * Note: Multi-line fields are automatically split into separate variables
 * (e.g., {{field_line_1}}, {{field_line_2}}) for use in email templates
 */
export function mapRowToContact(
    row: Record<string, string>,
    fieldMapping: Record<string, string>,
    additionalFields: string[] = []
): SuccessAiContact | null {
    const emailColumn = fieldMapping['email'];
    if (!emailColumn || !row[emailColumn]) {
        return null; // Email is required
    }

    const contact: SuccessAiContact = {
        email: row[emailColumn].trim()
    };

    // Map standard fields
    if (fieldMapping['firstName'] && row[fieldMapping['firstName']]) {
        contact.firstName = row[fieldMapping['firstName']];
    }
    if (fieldMapping['lastName'] && row[fieldMapping['lastName']]) {
        contact.lastName = row[fieldMapping['lastName']];
    }
    if (fieldMapping['companyName'] && row[fieldMapping['companyName']]) {
        contact.companyName = row[fieldMapping['companyName']];
    }
    if (fieldMapping['location'] && row[fieldMapping['location']]) {
        contact.location = row[fieldMapping['location']];
    }
    if (fieldMapping['website'] && row[fieldMapping['website']]) {
        contact.website = row[fieldMapping['website']];
    }

    // Helper: Split multi-line text into separate variables
    // This allows users to use {{field_line_1}} and {{field_line_2}} in templates to force spacing
    const addSplitVariables = (key: string, text: string, target: Record<string, string>) => {
        if (!text || !text.includes('\n')) return;

        const lines = text.split(/\r\n|\r|\n/)
            .map(l => l.trim())
            .filter(l => l.length > 0);

        if (lines.length > 1) {
            lines.forEach((line, index) => {
                target[`${key}_line_${index + 1}`] = line;
            });
        }
    };

    if (fieldMapping['iceBreaker'] && row[fieldMapping['iceBreaker']]) {
        const val = row[fieldMapping['iceBreaker']];
        contact.iceBreaker = val;
        // Auto-generate split variables for iceBreaker (for multi-line support)
        if (val.includes('\n') || val.includes('\r')) {
            contact.customVariables = contact.customVariables || {};
            addSplitVariables('iceBreaker', val, contact.customVariables);
        }
    }

    // Map additional fields as custom variables
    if (additionalFields.length > 0) {
        const customVariables: Record<string, string> = contact.customVariables || {};

        additionalFields.forEach(col => {
            // Only add if value exists and is not empty
            if (row[col] && row[col].trim() !== '') {
                const val = String(row[col]);
                customVariables[col] = val;

                // Auto-split multi-line custom variables for email template flexibility
                addSplitVariables(col, val, customVariables);
            }
        });

        if (Object.keys(customVariables).length > 0) {
            contact.customVariables = customVariables;
        }
    }

    return contact;
}
