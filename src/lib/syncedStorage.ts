import { supabase } from './supabase';

// Keys we want to sync between Supabase and localStorage
const SYNCED_KEYS = [
    'layerforge_ai_settings',
    'layerforge_ai_api_keys',
    'layerforge_ai_columns',
    'layerforge_prompt_templates',
    'layerforge_cloudinary_settings',
    'layerforge_templates',
    'cloudinary_cloud_name',
    'cloudinary_upload_preset',
    'layerforge_reoon_settings',
    'layerforge_apify_settings',
    'apify_custom_presets',
    'successai_api_key',
    'successai_key_validated',
    'successai_workspace_name',
    'smartlead_api_key',
    'smartlead_key_validated'
];

let _userId: string | null = null;
let _syncTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Set the current user ID for cloud sync.
 * Called once on login from useGlobalSettingsSync.
 */
export function setSyncUserId(userId: string | null) {
    _userId = userId;
}

/**
 * Read a synced key from localStorage.
 */
export function getSyncedItem(key: string): string | null {
    return localStorage.getItem(key);
}

/**
 * Write a synced key to localStorage AND trigger a debounced cloud sync.
 */
export function setSyncedItem(key: string, value: string): void {
    localStorage.setItem(key, value);

    if (SYNCED_KEYS.includes(key) && _userId) {
        debouncedSyncToCloud();
    }
}

/**
 * Remove a synced key from localStorage and trigger cloud sync.
 */
export function removeSyncedItem(key: string): void {
    localStorage.removeItem(key);

    if (SYNCED_KEYS.includes(key) && _userId) {
        debouncedSyncToCloud();
    }
}

/**
 * Download all synced settings from Supabase into localStorage.
 * Also performs a bidirectional merge: if there are local keys that
 * aren't in the cloud yet (e.g., from before sync was implemented),
 * push them up to Supabase.
 */
export async function downloadSettingsFromCloud(userId: string): Promise<void> {
    try {
        const { data, error } = await supabase
            .from('user_settings')
            .select('settings')
            .eq('user_id', userId)
            .single();

        if (error && error.code !== 'PGRST116') { // Ignore "no rows returned"
            throw error;
        }

        const cloudSettings = (data?.settings as Record<string, any>) || {};

        // 1. Download: cloud → localStorage (cloud wins for existing keys)
        SYNCED_KEYS.forEach(key => {
            if (cloudSettings[key] !== undefined && cloudSettings[key] !== null) {
                // If the value is already a string, store it directly.
                // Only JSON.stringify objects/arrays to avoid double-quoting.
                const val = cloudSettings[key];
                localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
            }
        });

        // 2. Upload: check if we have any local keys NOT in the cloud → push them up
        let hasLocalOnlyKeys = false;
        const mergedPayload: Record<string, any> = { ...cloudSettings };

        SYNCED_KEYS.forEach(key => {
            const localRaw = localStorage.getItem(key);
            if (localRaw && !cloudSettings[key]) {
                // Local key exists but cloud doesn't have it — migrate it
                hasLocalOnlyKeys = true;
                try { mergedPayload[key] = JSON.parse(localRaw); } catch { mergedPayload[key] = localRaw; }
            }
        });

        if (hasLocalOnlyKeys) {
            // Push the merged settings back to the cloud
            const { error: upsertError } = await supabase
                .from('user_settings')
                .upsert({
                    user_id: userId,
                    settings: mergedPayload,
                    updated_at: new Date().toISOString()
                });

            if (upsertError) {
                console.error('Failed to migrate local settings to cloud:', upsertError);
            } else {
                console.log('Migrated local-only settings to cloud');
            }
        }
    } catch (e) {
        console.error('Failed to load global settings from cloud:', e);
    }
}

/**
 * Debounced upload of all synced settings to Supabase.
 */
function debouncedSyncToCloud() {
    if (_syncTimeout) clearTimeout(_syncTimeout);

    _syncTimeout = setTimeout(async () => {
        if (!_userId) return;

        try {
            const payload: Record<string, any> = {};
            SYNCED_KEYS.forEach(k => {
                const raw = localStorage.getItem(k);
                if (raw) {
                    try { payload[k] = JSON.parse(raw); } catch { payload[k] = raw; }
                }
            });

            const { error } = await supabase
                .from('user_settings')
                .upsert({
                    user_id: _userId,
                    settings: payload,
                    updated_at: new Date().toISOString()
                });

            if (error) throw error;
        } catch (e) {
            console.error('Failed to sync global settings to cloud:', e);
        }
    }, 2000);
}
