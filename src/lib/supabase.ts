import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
        storage: localStorage,
        persistSession: true,
        autoRefreshToken: true,
    }
});

/**
 * Proxy an external image URL through Supabase Edge Function to avoid CORS issues
 */
export async function proxyImageUrl(url: string): Promise<string> {
    try {
        const { data, error } = await supabase.functions.invoke('image-proxy', {
            body: { url }
        });

        if (!error && data?.url) {
            return data.url;
        }
    } catch (e) {
        console.warn('Image proxy failed, using direct URL', e);
    }

    return url;
}
