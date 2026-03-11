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
    updateCell: (rowIndex: number, header: string, value: string) => void;
    tableContainerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Hook that adds Ctrl+C (copy) and Ctrl+V (paste) support to the CSV grid.
 * Works on selected cells, rows, columns, or ranges.
 * Copies as TSV (tab-separated) so it's compatible with Excel/Google Sheets.
 */
export function useGridClipboard({
    processedData,
    headers,
    selection,
    selectedCells,
    selectedRows,
    selectedColumns,
    editingCell,
    updateCell,
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

    // Copy: build TSV from selected cells
    const handleCopy = useCallback(async () => {
        const positions = getSelectedPositions();
        if (positions.length === 0) return;

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

        const tsv = lines.join('\n');

        try {
            await navigator.clipboard.writeText(tsv);
        } catch {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = tsv;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
    }, [getSelectedPositions, processedData, headers]);

    // Paste: read TSV from clipboard and write to cells starting from selection
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
            // Try individual cells
            const positions = getSelectedPositions();
            if (positions.length > 0) {
                startRow = Math.min(...positions.map(p => p.row));
                startCol = Math.min(...positions.map(p => p.col));
            }
        }

        // Parse TSV/CSV from clipboard
        const lines = text.split(/\r?\n/).filter(line => line.length > 0);

        for (let rOffset = 0; rOffset < lines.length; rOffset++) {
            const cells = lines[rOffset].split('\t');
            const targetVisualRow = startRow + rOffset;

            if (targetVisualRow >= processedData.length) break;

            const targetRow = processedData[targetVisualRow];
            if (!targetRow) continue;

            for (let cOffset = 0; cOffset < cells.length; cOffset++) {
                const targetCol = startCol + cOffset;
                if (targetCol >= headers.length) break;

                const header = headers[targetCol];
                if (header) {
                    updateCell(targetRow.__idx, header, cells[cOffset]);
                }
            }
        }
    }, [selection, getSelectedPositions, processedData, headers, updateCell]);

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
                } else if (e.key === 'v' || e.key === 'V') {
                    e.preventDefault();
                    handlePaste();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [editingCell, handleCopy, handlePaste]);

    return { handleCopy, handlePaste };
}
