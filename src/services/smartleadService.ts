import { toast } from 'sonner';

// Smartlead API Service
// API Documentation: https://api.smartlead.ai/reference/welcome

const API_BASE = 'https://server.smartlead.ai/api';
const CAMPAIGNS_CACHE_KEY = 'smartlead_campaigns_cache';
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// Settings persistence
export function getSmartleadSettings() {
    return {
        apiKey: localStorage.getItem('smartlead_api_key') || '',
        isValidated: localStorage.getItem('smartlead_key_validated') === 'true',
    };
}

export function saveSmartleadSettings(apiKey: string) {
    localStorage.setItem('smartlead_api_key', apiKey);
    localStorage.setItem('smartlead_key_validated', 'true');
}

export function clearSmartleadValidation() {
    localStorage.removeItem('smartlead_key_validated');
    clearCampaignCache();
}

// Campaign cache
export function getCachedCampaigns(): { campaigns: SmartleadCampaign[]; expired: boolean } | null {
    try {
        const cached = localStorage.getItem(CAMPAIGNS_CACHE_KEY);
        if (!cached) return null;

        const parsed = JSON.parse(cached);
        const { campaigns, timestamp } = parsed;

        if (!Array.isArray(campaigns) || typeof timestamp !== 'number') {
            clearCampaignCache();
            return null;
        }

        const expired = Date.now() - timestamp > CACHE_EXPIRY_MS;
        return { campaigns, expired };
    } catch {
        clearCampaignCache();
        return null;
    }
}

export function saveCampaignsToCache(campaigns: SmartleadCampaign[]) {
    localStorage.setItem(CAMPAIGNS_CACHE_KEY, JSON.stringify({
        campaigns,
        timestamp: Date.now()
    }));
}

export function clearCampaignCache() {
    localStorage.removeItem(CAMPAIGNS_CACHE_KEY);
}

// Types
export interface SmartleadCampaign {
    id: string; // Smartlead uses 'id' (some endpoints might use _id but usually id in response)
    name: string;
    status?: string;
}

export interface SmartleadLead {
    email: string;
    first_name?: string;
    last_name?: string;
    company_name?: string;
    website?: string;
    linkedin_profile?: string;
    phone_number?: string;
    location?: string;
    custom_fields?: Record<string, string>;
}

export interface AddLeadsResponse {
    ok: boolean;
    total_leads_received?: number;
    total_leads_added?: number;
    // Smartlead responses vary, but usually give some count
}

// API Functions

/**
 * Test API key validity (by trying to list campaigns with limit 1)
 */
export async function authenticate(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
        const response = await fetch(`${API_BASE}/v1/campaigns?api_key=${encodeURIComponent(apiKey)}&limit=1`);

        if (response.ok) {
            return { valid: true };
        } else {
            const errorText = await response.text();
            // Smartlead often returns text or minimal json for errors
            const errorMessage = errorText.length < 100 ? errorText : `Status: ${response.status}`;
            return { valid: false, error: errorMessage || 'Invalid API key' };
        }
    } catch (error) {
        return { valid: false, error: error instanceof Error ? error.message : 'Network error' };
    }
}

/**
 * List all campaigns
 */
export async function listCampaigns(apiKey: string): Promise<{ campaigns: SmartleadCampaign[]; error?: string }> {
    try {
        // Smartlead pagination is optional for small lists, but let's just get the default
        const response = await fetch(`${API_BASE}/v1/campaigns?api_key=${encodeURIComponent(apiKey)}`);

        if (!response.ok) {
            return { campaigns: [], error: `Failed to fetch campaigns: ${response.statusText}` };
        }

        const data = await response.json();
        const campaigns: SmartleadCampaign[] = [];

        // Handle Smartlead response format (usually array of campaigns)
        if (Array.isArray(data)) {
            data.forEach((c: any) => {
                campaigns.push({
                    id: c.id || c._id,
                    name: c.name || 'Unnamed Campaign',
                    status: c.status
                });
            });
        }

        return { campaigns };
    } catch (error) {
        return { campaigns: [], error: error instanceof Error ? error.message : 'Network error' };
    }
}

/**
 * Add leads to a campaign (Smartlead recommends batching, we'll use comparable sizing)
 */
export async function addLeads(
    apiKey: string,
    campaignId: string,
    leads: SmartleadLead[]
): Promise<{ status: 'success' | 'error'; count: number; error?: string }> {
    try {
        const response = await fetch(`${API_BASE}/v1/campaigns/${campaignId}/leads?api_key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                leads: leads
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            return {
                status: 'error',
                count: 0,
                error: `Failed to add leads: ${response.status} ${response.statusText} - ${errorText}`
            };
        }

        const data = await response.json();
        // Smartlead usually returns { ok: true, stats: { ... } } or similar
        // We assume success if 200 OK, but lets check data if possible

        return {
            status: 'success',
            count: leads.length // Smartlead doesn't always return exact count inserted in the simple response, so we assume sent = added for now unless error
        };
    } catch (error) {
        return {
            status: 'error',
            count: 0,
            error: error instanceof Error ? error.message : 'Network error'
        };
    }
}

/**
 * Push leads in batches
 */
export async function pushLeadsInBatches(
    apiKey: string,
    campaignId: string,
    leads: SmartleadLead[],
    onProgress?: (uploaded: number, total: number) => void,
    abortSignal?: AbortSignal
): Promise<{
    confirmedUploaded: number;
    errors: string[];
    batchResults: { batchNum: number; status: 'success' | 'error'; count: number; message?: string }[];
}> {
    const BATCH_SIZE = 100; // Smartlead might handle more, but 100 is safe
    const BATCH_DELAY_MS = 1000;
    const batches: SmartleadLead[][] = [];

    for (let i = 0; i < leads.length; i += BATCH_SIZE) {
        batches.push(leads.slice(i, i + BATCH_SIZE));
    }

    let confirmedUploaded = 0;
    const errors: string[] = [];
    const batchResults: any[] = [];

    for (let i = 0; i < batches.length; i++) {
        if (abortSignal?.aborted) {
            errors.push('Cancelled by user');
            break;
        }

        const batch = batches[i];
        const result = await addLeads(apiKey, campaignId, batch);

        if (result.status === 'error') {
            errors.push(`Batch ${i + 1}: ${result.error}`);
            batchResults.push({
                batchNum: i + 1,
                status: 'error',
                count: 0,
                message: result.error
            });
        } else {
            confirmedUploaded += batch.length;
            batchResults.push({
                batchNum: i + 1,
                status: 'success',
                count: batch.length
            });
        }

        onProgress?.(Math.min(leads.length, (i + 1) * BATCH_SIZE), leads.length);

        if (i < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
    }

    return { confirmedUploaded, errors, batchResults };
}

// Field mapping helper
export const SMARTLEAD_FIELDS = [
    { key: 'email', label: 'Email', required: true },
    { key: 'first_name', label: 'First Name', required: false },
    { key: 'last_name', label: 'Last Name', required: false },
    { key: 'company_name', label: 'Company Name', required: false },
    { key: 'website', label: 'Website', required: false },
    { key: 'linkedin_profile', label: 'LinkedIn Profile', required: false },
    { key: 'phone_number', label: 'Phone Number', required: false },
    { key: 'location', label: 'Location', required: false }
];

export function mapRowToSmartleadLead(
    row: Record<string, string>,
    fieldMapping: Record<string, string>,
    additionalFields: string[] = []
): SmartleadLead | null {
    const emailColumn = fieldMapping['email'];
    if (!emailColumn || !row[emailColumn]) {
        return null;
    }

    const lead: SmartleadLead = {
        email: row[emailColumn].trim()
    };

    if (fieldMapping['first_name'] && row[fieldMapping['first_name']]) lead.first_name = row[fieldMapping['first_name']];
    if (fieldMapping['last_name'] && row[fieldMapping['last_name']]) lead.last_name = row[fieldMapping['last_name']];
    if (fieldMapping['company_name'] && row[fieldMapping['company_name']]) lead.company_name = row[fieldMapping['company_name']];
    if (fieldMapping['website'] && row[fieldMapping['website']]) lead.website = row[fieldMapping['website']];
    if (fieldMapping['linkedin_profile'] && row[fieldMapping['linkedin_profile']]) lead.linkedin_profile = row[fieldMapping['linkedin_profile']];
    if (fieldMapping['phone_number'] && row[fieldMapping['phone_number']]) lead.phone_number = row[fieldMapping['phone_number']];
    if (fieldMapping['location'] && row[fieldMapping['location']]) lead.location = row[fieldMapping['location']];

    // Map custom fields
    if (additionalFields.length > 0) {
        const customFields: Record<string, string> = {};
        additionalFields.forEach(col => {
            if (row[col] && row[col].trim() !== '') {
                customFields[col] = row[col];
            }
        });

        if (Object.keys(customFields).length > 0) {
            lead.custom_fields = customFields;
        }
    }

    return lead;
}
