import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useCSVStore } from '@/stores/useCSVStore';
import { useCanvasStore } from '@/stores/useCanvasStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { toast } from 'sonner';

/**
 * Hook to manage synchronization between Zustand stores and Supabase
 */
export function useWorkspaceSync(projectId: string | null) {
    const [isSyncing, setIsSyncing] = useState(false);

    // Zustand state selectors
    const csvData = useCSVStore(s => s.data);
    const csvHeaders = useCSVStore(s => s.headers);
    const csvIsLoaded = useCSVStore(s => s.isLoaded);
    const readyForEditor = useCSVStore(s => s.readyForEditor);

    const canvasConfig = useCanvasStore(s => s.canvasConfig);
    const outputConfig = useCanvasStore(s => s.outputConfig);

    const layers = useLayerStore(s => s.layers);

    // Load project from Supabase
    useEffect(() => {
        async function loadProject() {
            if (!projectId) return;

            try {
                setIsSyncing(true);
                const { data, error } = await supabase
                    .from('projects')
                    .select('state')
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

                    toast.success('Workspace loaded successfully');
                }
            } catch (e) {
                console.error('Failed to load workspace:', e);
                toast.error('Failed to load workspace data');
            } finally {
                setIsSyncing(false);
            }
        }

        loadProject();
    }, [projectId]);

    // Auto-save to Supabase
    useEffect(() => {
        if (!projectId || !csvIsLoaded || isSyncing) return;

        const saveState = async () => {
            try {
                const fullState = {
                    csv: { data: csvData, headers: csvHeaders, readyForEditor },
                    canvas: { canvasConfig, outputConfig },
                    layers: { layers }
                };

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

    }, [projectId, csvData, csvHeaders, readyForEditor, canvasConfig, outputConfig, layers, csvIsLoaded, isSyncing]);

    return { isSyncing };
}
