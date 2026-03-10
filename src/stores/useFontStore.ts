import { create } from 'zustand';
import { saveFont, getAllFonts, deleteFont, loadFontIntoDocument, loadAllStoredFonts } from '@/services/fontStorage';
import { toast } from 'sonner';

interface FontState {
    customFonts: string[];
    isLoading: boolean;

    // Actions
    loadStoredFonts: () => Promise<void>;
    uploadFont: (file: File) => Promise<void>;
    removeFont: (name: string) => Promise<void>;
}

export const useFontStore = create<FontState>((set, get) => ({
    customFonts: [],
    isLoading: false,

    loadStoredFonts: async () => {
        set({ isLoading: true });
        try {
            const loadedFonts = await loadAllStoredFonts();
            set({ customFonts: loadedFonts });
        } catch (error) {
            console.error('Failed to load stored fonts:', error);
        } finally {
            set({ isLoading: false });
        }
    },

    uploadFont: async (file: File) => {
        // Extract font name from filename (remove extension)
        const fontName = file.name.replace(/\.(ttf|otf|woff|woff2)$/i, '');

        // Check if font already exists
        if (get().customFonts.includes(fontName)) {
            toast.error(`Font "${fontName}" already exists`);
            return;
        }

        try {
            // Read file as data URL
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });

            // Load into document
            await loadFontIntoDocument(fontName, dataUrl);

            // Save to IndexedDB
            await saveFont(fontName, dataUrl);

            // Update state
            set((state) => ({ customFonts: [...state.customFonts, fontName] }));

            toast.success(`Font "${fontName}" uploaded and saved`);
        } catch (error) {
            console.error('Failed to upload font:', error);
            toast.error('Failed to upload font');
        }
    },

    removeFont: async (name: string) => {
        try {
            await deleteFont(name);
            set((state) => ({ customFonts: state.customFonts.filter((f) => f !== name) }));
            toast.success(`Font "${name}" removed`);
        } catch (error) {
            console.error('Failed to remove font:', error);
            toast.error('Failed to remove font');
        }
    },
}));
