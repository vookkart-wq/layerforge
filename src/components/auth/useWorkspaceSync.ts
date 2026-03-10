import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useCSVStore } from '@/stores/useCSVStore';
import { useCanvasStore } from '@/stores/useCanvasStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { toast } from 'sonner';

/**
 * Hook to manage synchronization between Zustand stores and Supabase.
 * Returns { isSyncing, isHydrated } — isHydrated becomes true once the
 * initial load from Supabase is complete and stores are populated.
 */
export function useWorkspaceSync(projectId: string | null) {
    const [isSyncing, setIsSyncing] = useState(false);
    const [isHydrated, setIsHydrated] = useState(false);

    // Zustand state selectors
    const csvData = useCSVStore(s => s.data);
    const csvHeaders = useCSVStore(s => s.headers);
    const csvIsLoaded = useCSVStore(s => s.isLoaded);
    const readyForEditor = useCSVStore(s => s.readyForEditor);

    const canvasConfig = useCanvasStore(s => s.canvasConfig);
    const outputConfig = useCanvasStore(s => s.outputConfig);

    const layers = useLayerStore(s => s.layers);

    // Reset hydration state when project changes
    useEffect(() => {
        setIsHydrated(false);
    }, [projectId]);

    // Load project from Supabase
    useEffect(() => {
        async function loadProject() {
            if (!projectId) {
                setIsHydrated(true); // No project to load = immediately ready
                return;
            }

            try {
                setIsSyncing(true);
                const { data, error } = await supabase
                    .from('projects')
                    .select('state, name')
                    .eq('id', projectId)
                    .single();

                if (error) throw error;

                if (data && data.state) {
                    const state = data.state as any;

                    // Hydrate CSV Store
                    if (state.csv) {
                        useCSVStore.setState({
                            data: state.csv.data || [],
                            headers: state.csv.headers || [],
                            fileName: state.csv.fileName || data.name || 'Untitled',
                            isLoaded: true,
                            readyForEditor: state.csv.readyForEditor || false
                        });
                    }

                    // Hydrate Canvas Store
                    if (state.canvas) {
                        useCanvasStore.setState({
                            canvasConfig: state.canvas.canvasConfig,
                            outputConfig: state.canvas.outputConfig
                        });
                    }

                    // Hydrate Layer Store
                    if (state.layers) {
                        useLayerStore.setState({
                            layers: state.layers.layers || []
                        });
                    }

                    toast.success('Workspace loaded');
                }
            } catch (e) {
                console.error('Failed to load workspace:', e);
                toast.error('Failed to load workspace data');
            } finally {
                setIsSyncing(false);
                setIsHydrated(true);
            }
        }

        loadProject();
    }, [projectId]);

    // Auto-save to Supabase (only after hydration is complete)
    useEffect(() => {
        if (!projectId || !csvIsLoaded || isSyncing || !isHydrated) return;

        const saveState = async () => {
            try {
                const fullState = {
                    csv: { data: csvData, headers: csvHeaders, readyForEditor },
                    canvas: { canvasConfig, outputConfig },
                    layers: { layers }
                };

                // Guard: check payload size before sending to Supabase
                const payloadSize = new Blob([JSON.stringify(fullState)]).size;
                const MAX_PAYLOAD = 4.5 * 1024 * 1024; // 4.5 MB

                if (payloadSize > MAX_PAYLOAD) {
                    console.warn(
                        `Auto-save skipped: payload too large (${(payloadSize / 1024 / 1024).toFixed(1)}MB). ` +
                        `Max allowed: ${(MAX_PAYLOAD / 1024 / 1024).toFixed(1)}MB.`
                    );
                    return;
                }

                const { error } = await supabase
                    .from('projects')
                    .update({
                        state: fullState,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', projectId);

                if (error) throw error;
            } catch (e) {
                console.error('Auto-save failed:', e);
            }
        };

        // Debounce saves by 2 seconds
        const timeoutId = setTimeout(saveState, 2000);
        return () => clearTimeout(timeoutId);

    }, [projectId, csvData, csvHeaders, readyForEditor, canvasConfig, outputConfig, layers, csvIsLoaded, isSyncing, isHydrated]);

    return { isSyncing, isHydrated };
}
