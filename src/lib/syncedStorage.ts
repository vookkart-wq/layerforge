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
    'cloudinary_upload_preset'
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

        if (data?.settings) {
            const settings = data.settings as Record<string, any>;
            SYNCED_KEYS.forEach(key => {
                if (settings[key]) {
                    localStorage.setItem(key, JSON.stringify(settings[key]));
                }
            });
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
