import { useState, useCallback, useMemo, useRef, useEffect } from 'react';

// Selection types
export type SelectionMode = 'cell' | 'row' | 'column' | 'range';
export interface CellPosition { row: number; col: number; }
export interface Selection {
    mode: SelectionMode;
    start: CellPosition;
    end: CellPosition;
}

// Type for processed row with original index (matches CSVEditorPage)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProcessedRow = { [key: string]: any; __idx: number };

interface UseGridSelectionProps {
    processedData: ProcessedRow[];
    headers: string[];
    visibleHeaders: string[];
    editingCell: CellPosition | null;
    tableContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function useGridSelection({ processedData, headers, visibleHeaders, editingCell, tableContainerRef }: UseGridSelectionProps) {
    // ... existing state ...
    const [selection, setSelection] = useState<Selection | null>(null);
    const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
    const [lastSelectedRow, setLastSelectedRow] = useState<number | null>(null);
    const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
    const [lastSelectedColIdx, setLastSelectedColIdx] = useState<number | null>(null);
    const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
    const isSelectingRef = useRef(false);

    // Auto-scroll during cell selection drag
    const selectionScrollRef = useRef<number | null>(null);
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            // Only auto-scroll if we're actively selecting
            if (!isSelectingRef.current) {
                // Stop any existing scroll
                if (selectionScrollRef.current) {
                    cancelAnimationFrame(selectionScrollRef.current);
                    selectionScrollRef.current = null;
                }
                return;
            }

            const container = tableContainerRef.current;
            if (!container) return;

            const containerRect = container.getBoundingClientRect();
            const mouseY = e.clientY;
            const scrollThreshold = 60;
            const scrollSpeed = 10;

            // Clear existing scroll
            if (selectionScrollRef.current) {
                cancelAnimationFrame(selectionScrollRef.current);
                selectionScrollRef.current = null;
            }

            // Near bottom - scroll down
            if (mouseY > containerRect.bottom - scrollThreshold) {
                const scroll = () => {
                    if (isSelectingRef.current && container) {
                        container.scrollTop += scrollSpeed;
                        selectionScrollRef.current = requestAnimationFrame(scroll);
                    }
                };
                selectionScrollRef.current = requestAnimationFrame(scroll);
            }
            // Near top - scroll up
            else if (mouseY < containerRect.top + scrollThreshold + 40) {
                const scroll = () => {
                    if (isSelectingRef.current && container) {
                        container.scrollTop -= scrollSpeed;
                        selectionScrollRef.current = requestAnimationFrame(scroll);
                    }
                };
                selectionScrollRef.current = requestAnimationFrame(scroll);
            }
        };

        const handleMouseUp = () => {
            // Stop any scroll on mouse up
            if (selectionScrollRef.current) {
                cancelAnimationFrame(selectionScrollRef.current);
                selectionScrollRef.current = null;
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            if (selectionScrollRef.current) {
                cancelAnimationFrame(selectionScrollRef.current);
            }
        };
    }, []);

    // Pre-compute set of all selected cell keys for O(1) lookup
    const selectedCellSet = useMemo(() => {
        const set = new Set<string>();

        // Add range selection cells
        if (selection) {
            const minR = Math.min(selection.start.row, selection.end.row);
            const maxR = Math.max(selection.start.row, selection.end.row);
            const minC = Math.min(selection.start.col, selection.end.col);
            const maxC = Math.max(selection.start.col, selection.end.col);
            for (let r = minR; r <= maxR; r++) {
                for (let c = minC; c <= maxC; c++) {
                    set.add(`${r},${c}`);
                }
            }
        }

        // Add individually selected cells (Ctrl+Click)
        selectedCells.forEach(key => set.add(key));

        // Add row selections - map original indices to visual indices
        if (selectedRows.size > 0) {
            processedData.forEach((row, visIdx) => {
                if (selectedRows.has(row.__idx)) {
                    for (let c = 0; c < visibleHeaders.length; c++) {
                        set.add(`${visIdx},${c}`);
                    }
                }
            });
        }

        // Add column selections
        if (selectedColumns.size > 0) {
            visibleHeaders.forEach((col, colIdx) => {
                if (selectedColumns.has(col)) {
                    for (let r = 0; r < processedData.length; r++) {
                        set.add(`${r},${colIdx}`);
                    }
                }
            });
        }

        return set;
    }, [selection, selectedCells, selectedRows, selectedColumns, processedData, visibleHeaders]);

    // O(1) cell selection check
    const isCellSelected = useCallback((visualRowIdx: number, colIdx: number) => {
        return selectedCellSet.has(`${visualRowIdx},${colIdx}`);
    }, [selectedCellSet]);

    // Cell click - handles selection (uses VISUAL indices)
    const handleCellMouseDown = useCallback((visualRowIdx: number, colIdx: number, e: React.MouseEvent) => {
        // Allow default behavior for context menu, managing propagation elsewhere if needed
        if (e.button === 2) return;

        e.preventDefault();

        // Close any open cell editor when clicking on a different cell logic is handled in component via onBlur
        if (editingCell && (editingCell.row !== visualRowIdx || editingCell.col !== colIdx)) {
            (document.activeElement as HTMLElement)?.blur();
        }

        if (e.ctrlKey) {
            // Ctrl+Click: Toggle individual cell selection
            const cellKey = `${visualRowIdx},${colIdx}`;
            setSelectedCells(prev => {
                const newSet = new Set(prev);
                if (newSet.has(cellKey)) {
                    newSet.delete(cellKey);
                } else {
                    newSet.add(cellKey);
                }
                return newSet;
            });
            // Clear range selection and row/column selections when using Ctrl+Click on cells
            setSelection(null);
            setSelectedRows(new Set());
            setSelectedColumns(new Set());
        } else if (e.shiftKey && selection) {
            // Shift+Click: Extend range selection
            setSelection(prev => prev ? { ...prev, end: { row: visualRowIdx, col: colIdx } } : null);
            setSelectedCells(new Set()); // Clear individual selections
        } else {
            // Regular click: New single selection - clear all other selection types
            setSelection({ mode: 'cell', start: { row: visualRowIdx, col: colIdx }, end: { row: visualRowIdx, col: colIdx } });
            setSelectedCells(new Set()); // Clear individual selections
            setSelectedRows(new Set()); // Clear row selection
            setSelectedColumns(new Set()); // Clear column selection
            isSelectingRef.current = true;
        }
    }, [selection, editingCell]);

    const handleCellMouseEnter = useCallback((visualRowIdx: number, colIdx: number) => {
        if (isSelectingRef.current && selection) {
            setSelection(prev => prev ? { ...prev, end: { row: visualRowIdx, col: colIdx } } : null);
        }
    }, [selection]);

    const handleMouseUp = useCallback(() => {
        isSelectingRef.current = false;
    }, []);

    // Global mouse up listener
    useEffect(() => {
        document.addEventListener('mouseup', handleMouseUp);
        return () => document.removeEventListener('mouseup', handleMouseUp);
    }, [handleMouseUp]);

    // Column header click - SELECT column (multi-select supported)
    const handleColumnHeaderClick = useCallback((colIdx: number, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // Guard against invalid column index
        if (colIdx < 0 || colIdx >= headers.length) return;

        const colName = headers[colIdx];
        const newSelectedCols = new Set(e.ctrlKey ? selectedColumns : []);

        if (e.shiftKey && lastSelectedColIdx !== null) {
            // Range selection
            const start = Math.min(lastSelectedColIdx, colIdx);
            const end = Math.max(lastSelectedColIdx, colIdx);
            for (let i = start; i <= end; i++) {
                newSelectedCols.add(headers[i]);
            }
        } else if (e.ctrlKey) {
            // Toggle selection
            if (newSelectedCols.has(colName)) {
                newSelectedCols.delete(colName);
            } else {
                newSelectedCols.add(colName);
                setLastSelectedColIdx(colIdx);
            }
        } else {
            // Single selection - clear other selection types
            newSelectedCols.add(colName);
            setLastSelectedColIdx(colIdx);
            setSelectedCells(new Set());
            setSelectedRows(new Set());
        }

        setSelectedColumns(newSelectedCols);

        // Visual selection compatibility
        if (newSelectedCols.size > 0) {
            if (!e.ctrlKey && !e.shiftKey) {
                setSelection({
                    mode: 'column',
                    start: { row: 0, col: colIdx },
                    end: { row: processedData.length - 1, col: colIdx }
                });
            } else {
                setSelection(null);
            }
        }
    }, [selectedColumns, lastSelectedColIdx, headers, processedData.length]);

    // Row number click - select row (with multi-select support)
    const handleRowClick = useCallback((rowIdx: number, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // Find the visual index for this original row index
        const visualRowIdx = processedData.findIndex(r => r.__idx === rowIdx);

        const newSelectedRows = new Set(e.ctrlKey ? selectedRows : []);

        if (e.shiftKey && lastSelectedRow !== null) {
            // Range selection - MUST use visual indices from processedData
            const currentVisualIdx = visualRowIdx;
            const lastVisualIdx = processedData.findIndex(r => r.__idx === lastSelectedRow);

            if (currentVisualIdx !== -1 && lastVisualIdx !== -1) {
                const start = Math.min(lastVisualIdx, currentVisualIdx);
                const end = Math.max(lastVisualIdx, currentVisualIdx);

                // Select all rows currently VISIBLE in this range
                for (let i = start; i <= end; i++) {
                    newSelectedRows.add(processedData[i].__idx);
                }
            } else {
                // Fallback if last selected row is hidden/filtered
                newSelectedRows.add(rowIdx);
            }
        } else if (e.ctrlKey) {
            // Toggle selection
            if (newSelectedRows.has(rowIdx)) {
                newSelectedRows.delete(rowIdx);
            } else {
                newSelectedRows.add(rowIdx);
                setLastSelectedRow(rowIdx);
            }
        } else {
            // Single selection - clear other selection types
            newSelectedRows.add(rowIdx);
            setLastSelectedRow(rowIdx);
            setSelectedCells(new Set());
            setSelectedColumns(new Set());
        }

        setSelectedRows(newSelectedRows);

        // Update visual selection for compatibility - use VISUAL row index
        if (newSelectedRows.size > 0) {
            if (!e.ctrlKey && !e.shiftKey && visualRowIdx !== -1) {
                setSelection({
                    mode: 'row',
                    start: { row: visualRowIdx, col: 0 },
                    end: { row: visualRowIdx, col: headers.length - 1 }
                });
            } else {
                setSelection(null);
            }
        }
    }, [selectedRows, lastSelectedRow, processedData, headers.length]);

    return {
        selection, setSelection,
        selectedRows, setSelectedRows,
        selectedColumns, setSelectedColumns,
        selectedCells, setSelectedCells,
        isSelectingRef,
        isCellSelected,
        handleCellMouseDown,
        handleCellMouseEnter,
        handleColumnHeaderClick,
        handleRowClick
    };
}
