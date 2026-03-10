import { useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { setSyncUserId, downloadSettingsFromCloud } from '@/lib/syncedStorage';

/**
 * Global settings sync hook.
 * Downloads settings from Supabase on login and sets up the sync user ID
 * so that all subsequent setSyncedItem() calls auto-push to the cloud.
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

        // Download cloud settings into localStorage
        downloadSettingsFromCloud(user.id);

        return () => {
            setSyncUserId(null);
        };
    }, [user]);
}
