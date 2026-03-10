import { create } from 'zustand';
import type { Layer } from '../types';

interface HistoryEntry {
    layers: Layer[];
    selectedLayerId: string | null;
}

interface LayerState {
    layers: Layer[];
    selectedLayerId: string | null;

    // History for undo
    history: HistoryEntry[];
    historyIndex: number;

    // Actions
    addLayer: (layer: Layer) => void;
    updateLayer: (id: string, updates: Partial<Layer>) => void;
    removeLayer: (id: string) => void;
    reorderLayers: (fromIndex: number, toIndex: number) => void;
    toggleVisibility: (id: string) => void;
    selectLayer: (id: string | null) => void;
    setLayers: (layers: Layer[]) => void;

    // Undo/Redo
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
}

const MAX_HISTORY = 50;

// Helper to save state to history
const saveToHistory = (state: LayerState): Partial<LayerState> => {
    const newEntry: HistoryEntry = {
        layers: JSON.parse(JSON.stringify(state.layers)),
        selectedLayerId: state.selectedLayerId,
    };

    // Remove any redo history when new action is performed
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(newEntry);

    // Keep history size limited
    if (newHistory.length > MAX_HISTORY) {
        newHistory.shift();
    }

    return {
        history: newHistory,
        historyIndex: newHistory.length - 1,
    };
};

export const useLayerStore = create<LayerState>()(
    (set, get) => ({
        layers: [],
        selectedLayerId: null,
        history: [],
        historyIndex: -1,

        addLayer: (layer) => set((state) => ({
            layers: [...state.layers, layer],
            ...saveToHistory(state),
        })),

        updateLayer: (id, updates) => set((state) => ({
            layers: state.layers.map((layer) => {
                if (layer.id !== id) return layer;
                return { ...layer, ...updates } as Layer;
            }),
            ...saveToHistory(state),
        })),

        removeLayer: (id) => set((state) => ({
            layers: state.layers.filter((layer) => layer.id !== id),
            selectedLayerId: state.selectedLayerId === id ? null : state.selectedLayerId,
            ...saveToHistory(state),
        })),

        reorderLayers: (fromIndex, toIndex) => set((state) => {
            const newLayers = [...state.layers];
            const [removed] = newLayers.splice(fromIndex, 1);
            newLayers.splice(toIndex, 0, removed);
            return {
                layers: newLayers,
                ...saveToHistory(state),
            };
        }),

        toggleVisibility: (id) => set((state) => ({
            layers: state.layers.map((layer) =>
                layer.id === id ? { ...layer, visible: !layer.visible } as Layer : layer
            ),
            ...saveToHistory(state),
        })),

        selectLayer: (id) => set({ selectedLayerId: id }),

        setLayers: (layers) => set((state) => ({
            layers,
            ...saveToHistory(state),
        })),

        undo: () => set((state) => {
            if (state.historyIndex <= 0) return state;

            const prevIndex = state.historyIndex - 1;
            const prevEntry = state.history[prevIndex];

            if (!prevEntry) return state;

            return {
                layers: JSON.parse(JSON.stringify(prevEntry.layers)),
                selectedLayerId: prevEntry.selectedLayerId,
                historyIndex: prevIndex,
            };
        }),

        redo: () => set((state) => {
            if (state.historyIndex >= state.history.length - 1) return state;

            const nextIndex = state.historyIndex + 1;
            const nextEntry = state.history[nextIndex];

            if (!nextEntry) return state;

            return {
                layers: JSON.parse(JSON.stringify(nextEntry.layers)),
                selectedLayerId: nextEntry.selectedLayerId,
                historyIndex: nextIndex,
            };
        }),

        canUndo: () => get().historyIndex > 0,
        canRedo: () => get().historyIndex < get().history.length - 1,
    })
);
