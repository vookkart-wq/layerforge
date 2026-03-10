import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthProvider';

// Keys we want to sync between Supabase and localStorage
const SYNCED_KEYS = [
    'layerforge_ai_settings',
    'layerforge_ai_api_keys',
    'layerforge_prompt_templates',
    'layerforge_cloudinary_settings'
];

export function useGlobalSettingsSync() {
    const { user } = useAuth();

    // 1. Download settings on login
    useEffect(() => {
        if (!user) return;

        const loadSettings = async () => {
            try {
                const { data, error } = await supabase
                    .from('user_settings')
                    .select('settings')
                    .eq('user_id', user.id)
                    .single();

                if (error && error.code !== 'PGRST116') { // Ignore "no rows returned"
                    throw error;
                }

                if (data?.settings) {
                    const settings = data.settings as Record<string, any>;
                    // Hydrate localStorage with downloaded settings
                    SYNCED_KEYS.forEach(key => {
                        if (settings[key]) {
                            localStorage.setItem(key, JSON.stringify(settings[key]));
                        }
                    });
                }
            } catch (e) {
                console.error('Failed to load global settings:', e);
            }
        };

        loadSettings();
    }, [user]);

    // 2. Upload settings when localStorage changes
    useEffect(() => {
        if (!user) return;

        // We override original setItem to trigger pushes
        const originalSetItem = localStorage.setItem;

        localStorage.setItem = function (key: string, value: string) {
            originalSetItem.apply(this, [key, value]);

            if (SYNCED_KEYS.includes(key)) {
                // Debounce upload logic
                syncToCloud();
            }
        };

        let syncTimeout: NodeJS.Timeout;
        const syncToCloud = () => {
            clearTimeout(syncTimeout);
            syncTimeout = setTimeout(async () => {
                try {
                    // Gather all keys
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
                            user_id: user.id,
                            settings: payload,
                            updated_at: new Date().toISOString()
                        });

                    if (error) throw error;
                } catch (e) {
                    console.error('Failed to sync global settings to cloud:', e);
                }
            }, 2000); // 2 second debounce
        };

        return () => {
            localStorage.setItem = originalSetItem;
            clearTimeout(syncTimeout);
        };
    }, [user]);
}
