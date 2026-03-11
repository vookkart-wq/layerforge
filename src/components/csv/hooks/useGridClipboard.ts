import { useCallback, useEffect } from 'react';
import type { Selection } from './useGridSelection';

// Type for processed row with original index
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProcessedRow = { [key: string]: any; __idx: number };

interface UseGridClipboardProps {
    processedData: ProcessedRow[];
    headers: string[];
    selection: Selection | null;
    selectedCells: Set<string>;
    selectedRows: Set<number>;
    selectedColumns: Set<string>;
    editingCell: { row: number; col: number } | null;
    updateCells: (updates: { rowIndex: number; header: string; value: string }[]) => void;
    addColumn: (name: string, defaultValue?: string) => void;
    tableContainerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Hook that adds Ctrl+C (copy), Ctrl+X (cut), and Ctrl+V (paste) support to the CSV grid.
 * Works on selected cells, rows, columns, or ranges.
 * Copies as TSV (tab-separated) so it's compatible with Excel/Google Sheets.
 * All operations use batch updateCells for single-step undo (Ctrl+Z undoes the whole paste).
 */
export function useGridClipboard({
    processedData,
    headers,
    selection,
    selectedCells,
    selectedRows,
    selectedColumns,
    editingCell,
    updateCells,
    addColumn,
    tableContainerRef
}: UseGridClipboardProps) {

    // Get all selected cell positions as {row, col} pairs (visual indices)
    const getSelectedPositions = useCallback((): { row: number; col: number }[] => {
        const positions: { row: number; col: number }[] = [];

        // Range selection
        if (selection) {
            const minR = Math.min(selection.start.row, selection.end.row);
            const maxR = Math.max(selection.start.row, selection.end.row);
            const minC = Math.min(selection.start.col, selection.end.col);
            const maxC = Math.max(selection.start.col, selection.end.col);
            for (let r = minR; r <= maxR; r++) {
                for (let c = minC; c <= maxC; c++) {
                    positions.push({ row: r, col: c });
                }
            }
        }

        // Individual cell selections
        selectedCells.forEach(key => {
            const [r, c] = key.split(',').map(Number);
            if (!positions.some(p => p.row === r && p.col === c)) {
                positions.push({ row: r, col: c });
            }
        });

        // Row selections
        if (selectedRows.size > 0) {
            processedData.forEach((row, visIdx) => {
                if (selectedRows.has(row.__idx)) {
                    for (let c = 0; c < headers.length; c++) {
                        if (!positions.some(p => p.row === visIdx && p.col === c)) {
                            positions.push({ row: visIdx, col: c });
                        }
                    }
                }
            });
        }

        // Column selections
        if (selectedColumns.size > 0) {
            headers.forEach((col, colIdx) => {
                if (selectedColumns.has(col)) {
                    for (let r = 0; r < processedData.length; r++) {
                        if (!positions.some(p => p.row === r && p.col === colIdx)) {
                            positions.push({ row: r, col: colIdx });
                        }
                    }
                }
            });
        }

        return positions;
    }, [selection, selectedCells, selectedRows, selectedColumns, processedData, headers]);

    // Build TSV text from selected cells
    const buildTSVFromSelection = useCallback((): string => {
        const positions = getSelectedPositions();
        if (positions.length === 0) return '';

        // Find the bounding box of selected cells
        const rows = [...new Set(positions.map(p => p.row))].sort((a, b) => a - b);
        const cols = [...new Set(positions.map(p => p.col))].sort((a, b) => a - b);

        // Build a grid of values
        const lines: string[] = [];
        for (const r of rows) {
            const cells: string[] = [];
            for (const c of cols) {
                const row = processedData[r];
                const header = headers[c];
                if (row && header) {
                    cells.push(String(row[header] || ''));
                } else {
                    cells.push('');
                }
            }
            lines.push(cells.join('\t'));
        }

        return lines.join('\n');
    }, [getSelectedPositions, processedData, headers]);

    // Write text to clipboard
    const writeToClipboard = useCallback(async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
    }, []);

    // Copy: build TSV from selected cells
    const handleCopy = useCallback(async () => {
        const text = buildTSVFromSelection();
        if (text) await writeToClipboard(text);
    }, [buildTSVFromSelection, writeToClipboard]);

    // Cut: copy + clear source cells in one batch
    const handleCut = useCallback(async () => {
        const text = buildTSVFromSelection();
        if (!text) return;

        await writeToClipboard(text);

        // Clear all selected cells in a single batch (one Ctrl+Z to undo)
        const positions = getSelectedPositions();
        const updates: { rowIndex: number; header: string; value: string }[] = [];

        for (const pos of positions) {
            const row = processedData[pos.row];
            const header = headers[pos.col];
            if (row && header) {
                updates.push({ rowIndex: row.__idx, header, value: '' });
            }
        }

        if (updates.length > 0) {
            updateCells(updates);
        }
    }, [buildTSVFromSelection, writeToClipboard, getSelectedPositions, processedData, headers, updateCells]);

    // Paste: read TSV from clipboard, auto-extend columns if needed, batch update
    const handlePaste = useCallback(async () => {
        let text = '';
        try {
            text = await navigator.clipboard.readText();
        } catch {
            return; // Can't read clipboard
        }

        if (!text) return;

        // Find the top-left corner of the current selection as the paste anchor
        let startRow = 0;
        let startCol = 0;

        if (selection) {
            startRow = Math.min(selection.start.row, selection.end.row);
            startCol = Math.min(selection.start.col, selection.end.col);
        } else {
            const positions = getSelectedPositions();
            if (positions.length > 0) {
                startRow = Math.min(...positions.map(p => p.row));
                startCol = Math.min(...positions.map(p => p.col));
            }
        }

        // Parse TSV/CSV from clipboard
        const lines = text.split(/\r?\n/).filter(line => line.length > 0);
        if (lines.length === 0) return;

        // Determine the max number of columns in the pasted data
        const pastedCols = Math.max(...lines.map(line => line.split('\t').length));
        const neededCols = startCol + pastedCols;

        // Auto-extend columns if paste data is wider than the grid
        if (neededCols > headers.length) {
            const columnsToAdd = neededCols - headers.length;
            for (let i = 0; i < columnsToAdd; i++) {
                addColumn(`Column_${headers.length + i + 1}`);
            }
        }

        // Get the current headers (may have been extended)
        // We need to re-read since addColumn modifies the store
        // Use a small delay to let the store update, then batch the cell updates
        // Actually, addColumn is synchronous in Zustand, so we can proceed
        // But we need to get the latest headers after adding columns
        setTimeout(() => {
            // Re-read headers from the store (they may have been extended)
            const currentHeaders = headers.length >= neededCols
                ? headers
                : [...headers, ...Array.from({ length: neededCols - headers.length }, (_, i) => `Column_${headers.length + i + 1}`)];

            // Build all updates as a single batch
            const updates: { rowIndex: number; header: string; value: string }[] = [];

            for (let rOffset = 0; rOffset < lines.length; rOffset++) {
                const cells = lines[rOffset].split('\t');
                const targetVisualRow = startRow + rOffset;

                if (targetVisualRow >= processedData.length) break;

                const targetRow = processedData[targetVisualRow];
                if (!targetRow) continue;

                for (let cOffset = 0; cOffset < cells.length; cOffset++) {
                    const targetCol = startCol + cOffset;
                    if (targetCol >= currentHeaders.length) break;

                    const header = currentHeaders[targetCol];
                    if (header) {
                        updates.push({
                            rowIndex: targetRow.__idx,
                            header,
                            value: cells[cOffset]
                        });
                    }
                }
            }

            if (updates.length > 0) {
                updateCells(updates);
            }
        }, 0);
    }, [selection, getSelectedPositions, processedData, headers, updateCells, addColumn]);

    // Listen for keyboard events
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't intercept if we're editing a cell (textarea has focus)
            if (editingCell) return;

            // Don't intercept if user is typing in an input/textarea
            const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'c' || e.key === 'C') {
                    e.preventDefault();
                    handleCopy();
                } else if (e.key === 'x' || e.key === 'X') {
                    e.preventDefault();
                    handleCut();
                } else if (e.key === 'v' || e.key === 'V') {
                    e.preventDefault();
                    handlePaste();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [editingCell, handleCopy, handleCut, handlePaste]);

    return { handleCopy, handleCut, handlePaste };
}
