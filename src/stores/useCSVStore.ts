import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CSVRow } from '../types';

// Snapshot for history
interface CSVSnapshot {
    data: CSVRow[];
    headers: string[];
}

interface CSVState {
    data: CSVRow[];
    headers: string[];
    isLoaded: boolean;
    readyForEditor: boolean;

    // Sort state (persistent across views)
    sortColumn: string | null;
    sortDirection: 'asc' | 'desc';

    // History for undo/redo
    history: CSVSnapshot[];
    historyIndex: number;
    canUndo: boolean;
    canRedo: boolean;

    // Actions
    setCSVData: (data: CSVRow[], headers: string[]) => void;
    clearCSVData: () => void;
    proceedToEditor: () => void;
    goBackToCSVEditor: () => void;

    // Sort actions
    setSortColumn: (column: string | null) => void;
    setSortDirection: (direction: 'asc' | 'desc') => void;
    getSortedIndices: () => number[];

    // Editing actions
    updateCell: (rowIndex: number, header: string, value: string) => void;
    updateCells: (updates: { rowIndex: number; header: string; value: string }[]) => void;
    addColumn: (name: string, defaultValue?: string) => void;
    deleteColumn: (header: string) => void;
    deleteColumns: (headers: string[]) => void;
    reorderColumns: (fromIndex: number, toIndex: number) => void;
    renameColumn: (oldName: string, newName: string) => void;
    addRow: () => void;
    deleteRow: (index: number) => void;
    deleteRows: (indices: number[]) => void;
    addLogoColumn: (domainColumn: string, newColumnName?: string) => void;

    // Undo/Redo
    undo: () => void;
    redo: () => void;

    // Merge
    mergeCSV: (enrichedData: CSVRow[], enrichedHeaders: string[], baseIdCol: string, enrichedIdCol: string, columnsToMerge: string[]) => void;

    // Transform
    transformColumn: (column: string, transformType: string, newColumnName?: string) => void;
}

const MAX_HISTORY = 50;

// Logo.dev API configuration
const LOGO_DEV_TOKEN = 'pk_ea8PZlAjROi6aBQQXOvnEQ';
const LOGO_DEV_SIZE = 200;

function extractDomain(value: string): string {
    if (!value) return '';
    const trimmed = value.trim().toLowerCase();

    if (trimmed.includes('@')) {
        const parts = trimmed.split('@');
        return parts[parts.length - 1];
    }

    try {
        const urlString = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
        const url = new URL(urlString);
        return url.hostname.replace(/^www\./, '');
    } catch {
        return trimmed.replace(/^www\./, '').split('/')[0];
    }
}

function generateLogoUrl(domain: string): string {
    const cleanDomain = extractDomain(domain);
    if (!cleanDomain) return '';
    return `https://img.logo.dev/${cleanDomain}?token=${LOGO_DEV_TOKEN}&size=${LOGO_DEV_SIZE}&fallback=404`;
}

// Helper to push to history
function pushHistory(state: CSVState): Partial<CSVState> {
    const snapshot: CSVSnapshot = {
        data: JSON.parse(JSON.stringify(state.data)),
        headers: [...state.headers]
    };

    // Truncate future history if we're not at the end
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(snapshot);

    // Limit history size
    if (newHistory.length > MAX_HISTORY) {
        newHistory.shift();
    }

    return {
        history: newHistory,
        historyIndex: newHistory.length - 1,
        canUndo: true,
        canRedo: false
    };
}

export const useCSVStore = create<CSVState>()(
    persist(
        (set, get) => ({
            data: [],
            headers: [],
            isLoaded: false,
            readyForEditor: false,
            sortColumn: null,
            sortDirection: 'asc' as const,
            history: [],
            historyIndex: -1,
            canUndo: false,
            canRedo: false,

            setSortColumn: (column) => set({ sortColumn: column }),
            setSortDirection: (direction) => set({ sortDirection: direction }),

            getSortedIndices: () => {
                const { data, sortColumn, sortDirection } = get();
                if (!sortColumn) return data.map((_, i) => i);

                const indices = data.map((_, i) => i);
                indices.sort((a, b) => {
                    const aVal = String(data[a][sortColumn] || '').toLowerCase();
                    const bVal = String(data[b][sortColumn] || '').toLowerCase();
                    const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
                    return sortDirection === 'asc' ? cmp : -cmp;
                });
                return indices;
            },

            setCSVData: (data, headers) => {
                const snapshot: CSVSnapshot = { data: JSON.parse(JSON.stringify(data)), headers: [...headers] };
                set({
                    data,
                    headers,
                    isLoaded: true,
                    readyForEditor: false,
                    history: [snapshot],
                    historyIndex: 0,
                    canUndo: false,
                    canRedo: false
                });
            },

            clearCSVData: () => set({
                data: [],
                headers: [],
                isLoaded: false,
                readyForEditor: false,
                history: [],
                historyIndex: -1,
                canUndo: false,
                canRedo: false
            }),

            proceedToEditor: () => set({ readyForEditor: true }),

            goBackToCSVEditor: () => set({ readyForEditor: false }),

            updateCell: (rowIndex, header, value) => {
                const state = get();
                if (rowIndex < 0 || rowIndex >= state.data.length) return;

                const newData = [...state.data];
                newData[rowIndex] = { ...newData[rowIndex], [header]: value };

                set({
                    data: newData,
                    ...pushHistory({ ...state, data: newData })
                });
            },

            updateCells: (updates) => {
                const state = get();
                if (updates.length === 0) return;

                const newData = [...state.data];
                let hasChanges = false;

                updates.forEach(({ rowIndex, header, value }) => {
                    if (rowIndex >= 0 && rowIndex < newData.length) {
                        const currentRow = newData[rowIndex];
                        // Only update if value is different to avoid no-op history entries
                        if (currentRow[header] !== value) {
                            newData[rowIndex] = { ...currentRow, [header]: value };
                            hasChanges = true;
                        }
                    }
                });

                if (hasChanges) {
                    set({
                        data: newData,
                        ...pushHistory({ ...state, data: newData })
                    });
                }
            },

            addColumn: (name, defaultValue = '') => {
                const state = get();
                let colName = name;

                if (state.headers.includes(colName)) {
                    let counter = 1;
                    while (state.headers.includes(`${colName}_${counter}`)) counter++;
                    colName = `${colName}_${counter}`;
                }

                const newHeaders = [...state.headers, colName];
                const newData = state.data.map(row => ({ ...row, [colName]: defaultValue }));

                set({
                    headers: newHeaders,
                    data: newData,
                    ...pushHistory({ ...state, headers: newHeaders, data: newData })
                });
            },

            deleteColumn: (header) => {
                const state = get();
                const newHeaders = state.headers.filter(h => h !== header);
                const newData = state.data.map(row => {
                    const newRow = { ...row };
                    delete newRow[header];
                    return newRow;
                });

                set({
                    headers: newHeaders,
                    data: newData,
                    ...pushHistory({ ...state, headers: newHeaders, data: newData })
                });
            },

            deleteColumns: (headersToDelete) => {
                const state = get();
                if (headersToDelete.length === 0) return;

                const headersSet = new Set(headersToDelete);
                const newHeaders = state.headers.filter(h => !headersSet.has(h));
                const newData = state.data.map(row => {
                    const newRow = { ...row };
                    headersToDelete.forEach(h => delete newRow[h]);
                    return newRow;
                });

                set({
                    headers: newHeaders,
                    data: newData,
                    ...pushHistory({ ...state, headers: newHeaders, data: newData })
                });
            },

            reorderColumns: (fromIndex, toIndex) => {
                const state = get();
                if (fromIndex === toIndex) return;
                if (fromIndex < 0 || fromIndex >= state.headers.length) return;
                if (toIndex < 0 || toIndex >= state.headers.length) return;

                const newHeaders = [...state.headers];
                const [movedHeader] = newHeaders.splice(fromIndex, 1);
                newHeaders.splice(toIndex, 0, movedHeader);

                set({
                    headers: newHeaders,
                    ...pushHistory({ ...state, headers: newHeaders })
                });
            },

            renameColumn: (oldName, newName) => {
                const state = get();
                if (!oldName || !newName || oldName === newName) return;
                if (!state.headers.includes(oldName)) return;
                if (state.headers.includes(newName)) return; // Prevent duplicate names

                const newHeaders = state.headers.map(h => h === oldName ? newName : h);
                const newData = state.data.map(row => {
                    const newRow = { ...row };
                    if (oldName in newRow) {
                        newRow[newName] = newRow[oldName];
                        delete newRow[oldName];
                    }
                    return newRow;
                });

                set({
                    headers: newHeaders,
                    data: newData,
                    ...pushHistory({ ...state, headers: newHeaders, data: newData })
                });
            },

            addRow: () => {
                const state = get();
                const newRow: CSVRow = {};
                state.headers.forEach(h => { newRow[h] = ''; });
                const newData = [...state.data, newRow];

                set({
                    data: newData,
                    ...pushHistory({ ...state, data: newData })
                });
            },

            deleteRow: (index) => {
                const state = get();
                if (index < 0 || index >= state.data.length) return;

                const newData = state.data.filter((_, i) => i !== index);

                set({
                    data: newData,
                    ...pushHistory({ ...state, data: newData })
                });
            },

            deleteRows: (indices) => {
                const state = get();
                if (indices.length === 0) return;

                const indicesToDelete = new Set(indices);
                const newData = state.data.filter((_, i) => !indicesToDelete.has(i));

                set({
                    data: newData,
                    ...pushHistory({ ...state, data: newData })
                });
            },

            addLogoColumn: (domainColumn, newColumnName = 'logo_url') => {
                const state = get();
                if (!state.headers.includes(domainColumn)) return;

                let colName = newColumnName;
                if (state.headers.includes(colName)) {
                    let counter = 1;
                    while (state.headers.includes(`${colName}_${counter}`)) counter++;
                    colName = `${colName}_${counter}`;
                }

                const newHeaders = [...state.headers, colName];
                const newData = state.data.map(row => ({
                    ...row,
                    [colName]: generateLogoUrl(row[domainColumn] || '')
                }));

                set({
                    headers: newHeaders,
                    data: newData,
                    ...pushHistory({ ...state, headers: newHeaders, data: newData })
                });
            },

            undo: () => {
                const state = get();
                if (state.historyIndex <= 0) return;

                const newIndex = state.historyIndex - 1;
                const snapshot = state.history[newIndex];

                set({
                    data: JSON.parse(JSON.stringify(snapshot.data)),
                    headers: [...snapshot.headers],
                    historyIndex: newIndex,
                    canUndo: newIndex > 0,
                    canRedo: true
                });
            },

            redo: () => {
                const state = get();
                if (state.historyIndex >= state.history.length - 1) return;

                const newIndex = state.historyIndex + 1;
                const snapshot = state.history[newIndex];

                set({
                    data: JSON.parse(JSON.stringify(snapshot.data)),
                    headers: [...snapshot.headers],
                    historyIndex: newIndex,
                    canUndo: true,
                    canRedo: newIndex < state.history.length - 1
                });
            },

            mergeCSV: (enrichedData, enrichedHeaders, baseIdCol, enrichedIdCol, columnsToMerge) => {
                const state = get();

                // Create a lookup map from enriched data
                const enrichedMap = new Map<string, CSVRow>();
                enrichedData.forEach(row => {
                    const key = String(row[enrichedIdCol] || '').toLowerCase().trim();
                    if (key) {
                        enrichedMap.set(key, row);
                    }
                });

                // Add new columns to headers (avoid duplicates) and track mappings
                const newHeaders = [...state.headers];
                const columnMappings: { original: string; renamed: string }[] = [];

                columnsToMerge.forEach(col => {
                    let colName = col;
                    if (newHeaders.includes(colName)) {
                        let counter = 1;
                        while (newHeaders.includes(`${colName}_${counter}`)) counter++;
                        colName = `${colName}_${counter}`;
                    }
                    newHeaders.push(colName);
                    columnMappings.push({ original: col, renamed: colName });
                });

                // Merge data
                const newData = state.data.map(row => {
                    const baseKey = String(row[baseIdCol] || '').toLowerCase().trim();
                    const enrichedRow = enrichedMap.get(baseKey);

                    const mergedRow = { ...row };
                    columnMappings.forEach(({ original, renamed }) => {
                        mergedRow[renamed] = enrichedRow ? (enrichedRow[original] || '') : '';
                    });

                    return mergedRow;
                });

                set({
                    headers: newHeaders,
                    data: newData,
                    ...pushHistory({ ...state, headers: newHeaders, data: newData })
                });
            },

            transformColumn: (column, transformType, newColumnName) => {
                const state = get();

                // Transform functions
                const transforms: Record<string, (value: string) => string> = {
                    // LinkedIn URL encoding - encode the path after /in/ or /company/
                    'linkedin-encode': (value) => {
                        if (!value) return value;
                        if (value.includes('/in/')) {
                            const [base, rest] = value.split('/in/');
                            const slug = (rest || '').split('/')[0].split('?')[0];
                            return base + '/in/' + encodeURIComponent(slug).replace(/'/g, '%27');
                        }
                        if (value.includes('/company/')) {
                            const [base, rest] = value.split('/company/');
                            const slug = (rest || '').split('/')[0].split('?')[0];
                            return base + '/company/' + encodeURIComponent(slug).replace(/'/g, '%27');
                        }
                        return value;
                    },

                    // Extract domain from email or URL
                    'extract-domain': (value) => {
                        if (!value) return '';
                        const trimmed = value.trim().toLowerCase();

                        // Email
                        if (trimmed.includes('@')) {
                            return trimmed.split('@').pop() || '';
                        }

                        // URL
                        try {
                            const urlStr = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
                            return new URL(urlStr).hostname.replace(/^www\./, '');
                        } catch {
                            return trimmed.replace(/^www\./, '').split('/')[0];
                        }
                    },

                    // Case transforms
                    'uppercase': (value) => value.toUpperCase(),
                    'lowercase': (value) => value.toLowerCase(),
                    'capitalize': (value) => value.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '),

                    // Trim whitespace
                    'trim': (value) => value.trim(),

                    // Remove duplicates spaces
                    'clean-spaces': (value) => value.replace(/\s+/g, ' ').trim(),

                    // Extract numbers only
                    'extract-numbers': (value) => value.replace(/\D/g, ''),

                    // Remove special characters
                    'remove-special': (value) => value.replace(/[^a-zA-Z0-9\s]/g, '')
                };

                const transformFn = transforms[transformType];
                if (!transformFn) return;

                // If newColumnName is provided, create a new column with transformed data
                if (newColumnName) {
                    // Make column name unique if needed
                    let colName = newColumnName;
                    if (state.headers.includes(colName)) {
                        let counter = 1;
                        while (state.headers.includes(`${colName}_${counter}`)) counter++;
                        colName = `${colName}_${counter}`;
                    }

                    const newHeaders = [...state.headers, colName];
                    const newData = state.data.map(row => ({
                        ...row,
                        [colName]: transformFn(row[column] || '')
                    }));

                    set({
                        headers: newHeaders,
                        data: newData,
                        ...pushHistory({ ...state, headers: newHeaders, data: newData })
                    });
                } else {
                    // Modify original column in place
                    const newData = state.data.map(row => ({
                        ...row,
                        [column]: transformFn(row[column] || '')
                    }));

                    set({
                        data: newData,
                        ...pushHistory({ ...state, data: newData })
                    });
                }
            }
        }),
        {
            name: 'csv-editor-storage',
            partialize: (state) => ({
                data: state.data,
                headers: state.headers,
                isLoaded: state.isLoaded,
                readyForEditor: state.readyForEditor,
                sortColumn: state.sortColumn,
                sortDirection: state.sortDirection
            })
        }
    )
);
