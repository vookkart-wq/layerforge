import { useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { setSyncUserId, downloadSettingsFromCloud } from '@/lib/syncedStorage';
import { loadReoonSettings } from '@/services/reoonService';
import { loadApifySettings } from '@/services/apifyService';

/**
 * Global settings sync hook.
 * Downloads settings from Supabase on login and sets up the sync user ID
 * so that all subsequent setSyncedItem() calls auto-push to the cloud.
 *
 * After downloading, re-initializes service modules that cache settings
 * at import time (fixes race condition on new browser login).
 */
export function useGlobalSettingsSync() {
    const { user } = useAuth();

    useEffect(() => {
        if (!user) {
            setSyncUserId(null);
            return;
        }

        // Set the user ID so syncedStorage knows where to push
        setSyncUserId(user.id);

        // Download cloud settings into localStorage, then re-init services
        downloadSettingsFromCloud(user.id).then(() => {
            // These services cache settings at module load time.
            // After downloading from cloud, re-read so they pick up the new values.
            loadReoonSettings();
            loadApifySettings();
        });

        return () => {
            setSyncUserId(null);
        };
    }, [user]);
}
