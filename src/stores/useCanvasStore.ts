import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CanvasConfig, OutputConfig } from '../types';

interface GridSettings {
    showGrid: boolean;
    showGuides: boolean;
    snapToGrid: boolean;
    gridSize: number; // pixels
}

interface CanvasState {
    canvasConfig: CanvasConfig;
    outputConfig: OutputConfig;
    previewRowIndex: number;
    gridSettings: GridSettings;

    // Actions
    setCanvasConfig: (config: Partial<CanvasConfig>) => void;
    setOutputConfig: (config: Partial<OutputConfig>) => void;
    setPreviewRowIndex: (index: number) => void;
    setGridSettings: (settings: Partial<GridSettings>) => void;

    // Helper for snapping
    snapValue: (value: number) => number;
}

export const useCanvasStore = create<CanvasState>()(
    persist(
        (set, get) => ({
            canvasConfig: {
                width: 1080,
                height: 1080,
                backgroundColor: '#ffffff',
            },
            outputConfig: {
                width: 1080,
                height: 1080,
                format: 'png',
                quality: 90,
            },
            previewRowIndex: 0,
            gridSettings: {
                showGrid: false,
                showGuides: true,
                snapToGrid: true,
                gridSize: 20,
            },

            setCanvasConfig: (config) => set((state) => ({
                canvasConfig: { ...state.canvasConfig, ...config },
                // Sync output config width/height with canvas
                outputConfig: {
                    ...state.outputConfig,
                    width: config.width ?? state.outputConfig.width,
                    height: config.height ?? state.outputConfig.height,
                },
            })),

            setOutputConfig: (config) => set((state) => ({
                outputConfig: { ...state.outputConfig, ...config },
            })),

            setPreviewRowIndex: (index) => set({ previewRowIndex: index }),

            setGridSettings: (settings) => set((state) => ({
                gridSettings: { ...state.gridSettings, ...settings },
            })),

            snapValue: (value) => {
                const { gridSettings } = get();
                if (!gridSettings.snapToGrid) return value;
                return Math.round(value / gridSettings.gridSize) * gridSettings.gridSize;
            },
        }),
        {
            name: 'canvas-config-storage',
            partialize: (state) => ({
                canvasConfig: state.canvasConfig,
                outputConfig: state.outputConfig,
                gridSettings: state.gridSettings,
            }),
        }
    )
);
