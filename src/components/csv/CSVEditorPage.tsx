import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { ArrowRight, Plus, Trash2, Download, Image, X, Layers, ArrowLeft, Search, ArrowUp, ArrowDown, GripVertical, Undo2, Redo2, Merge, Wand2, Sparkles, Play, Database, FileText, Mail, ChevronDown, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useCSVStore } from '@/stores/useCSVStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { useCanvasStore } from '@/stores/useCanvasStore';
import { MergeCSVDialog } from './MergeCSVDialog';
import { TransformColumnDialog } from './TransformColumnDialog';
import { AIColumnDialog, aiProcessingState } from './AIColumnDialog';
import { ApifyDialog } from './ApifyDialog';
import { ReoonEmailDialog } from './ReoonEmailDialog';
import { SuccessAiDialog } from './SuccessAiDialog';
import { SmartleadDialog } from './SmartleadDialog';
import { EnrichmentViewerDialog } from './EnrichmentViewerDialog';
import { TemplateColumnDialog } from './TemplateColumnDialog';
import { ExportDialog } from './ExportDialog';
import { apifyProcessingState, isEnrichmentColumn, getEnrichmentFromColumn, getEnrichmentDisplayName, getActorIdFromColumn } from '@/services/apifyService';
import { isAIColumn, getAIColumnConfig, getUnprocessedRowCount } from '@/services/aiService';
import { reoonProcessingState } from '@/services/reoonService';
import { toast } from 'sonner';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Loader2 } from 'lucide-react';
import { CellEditor } from './CellEditor';
import { LinkCell } from './LinkCell';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useGridSelection } from './hooks/useGridSelection';
import { useGridEditing } from './hooks/useGridEditing';
import { useGridFill } from './hooks/useGridFill';
import { useGridClipboard } from './hooks/useGridClipboard';
import { GridCell } from './GridCell';

// Selection types
type SelectionMode = 'cell' | 'row' | 'column' | 'range';
interface CellPosition { row: number; col: number; }
interface Selection {
    mode: SelectionMode;
    start: CellPosition;
    end: CellPosition;
}

export function CSVEditorPage({ onReturnToDashboard }: { onReturnToDashboard?: () => void }) {
    const {
        data, headers,
        updateCell, updateCells, addColumn, deleteColumn, deleteColumns, reorderColumns, renameColumn, addRow, deleteRow, deleteRows, addLogoColumn,
        proceedToEditor, clearCSVData,
        undo, redo, canUndo, canRedo,
        sortColumn, sortDirection, setSortColumn, setSortDirection
    } = useCSVStore();

    // Other stores for resetting
    const setLayers = useLayerStore(state => state.setLayers);
    const selectLayer = useLayerStore(state => state.selectLayer);

    // Config setter (optional, if we want to reset canvas size too)
    // const setCanvasConfig = useCanvasStore(state => state.setCanvasConfig);

    // Full reset handler
    const handleNewProject = useCallback(() => {
        if (window.confirm('Start a new project? This will clear all current data (CSV, Layers, Settings).')) {
            clearCSVData();
            setLayers([]);
            selectLayer(null);
            // We can add canvas reset here if needed, e.g.
            // useCanvasStore.getState().setCanvasConfig({...defaults}) 
            // For now, layer reset is most critical.
        }
    }, [clearCSVData, setLayers, selectLayer]);

    // Column widths
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
        const widths: Record<string, number> = {};
        headers.forEach(h => { widths[h] = 150; });
        return widths;
    });

    // AI Processing state for cancel bar
    const [aiProcessing, setAiProcessing] = useState({ isProcessing: false, columnName: '', processedCount: 0, totalCount: 0 });

    useEffect(() => {
        const unsubscribe = aiProcessingState.subscribe(() => {
            setAiProcessing({
                isProcessing: aiProcessingState.isProcessing,
                columnName: aiProcessingState.columnName,
                processedCount: aiProcessingState.processedCount,
                totalCount: aiProcessingState.totalCount
            });
        });
        return () => { unsubscribe(); };
    }, []);

    // Apify Processing state for toolbar indicator
    const [apifyProcessing, setApifyProcessing] = useState({ isProcessing: false, actorName: '', processedCount: 0, totalCount: 0 });

    useEffect(() => {
        const unsubscribe = apifyProcessingState.subscribe(() => {
            setApifyProcessing({
                isProcessing: apifyProcessingState.isProcessing,
                actorName: apifyProcessingState.actorName,
                processedCount: apifyProcessingState.processedCount,
                totalCount: apifyProcessingState.totalCount
            });
        });
        return () => { unsubscribe(); };
    }, []);

    // Reoon Processing state for toolbar indicator
    const [reoonProcessing, setReoonProcessing] = useState({ isProcessing: false, processedCount: 0, totalCount: 0 });

    useEffect(() => {
        const unsubscribe = reoonProcessingState.subscribe(() => {
            setReoonProcessing({
                isProcessing: reoonProcessingState.isProcessing,
                processedCount: reoonProcessingState.processedCount,
                totalCount: reoonProcessingState.totalCount
            });
        });
        return () => { unsubscribe(); };
    }, []);

    // State refs
    const tableContainerRef = useRef<HTMLDivElement>(null);

    // Search
    const [searchQuery, setSearchQuery] = useState('');

    // Processed data (filtered & sorted) - Stable Sort Implementation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type ProcessedRow = { [key: string]: any; __idx: number };

    // 1. Filtered Data (Always up-to-date with content)
    const filteredData = useMemo((): ProcessedRow[] => {
        let result: ProcessedRow[] = data.map((row, idx) => ({ ...row, __idx: idx }));

        // Filter
        if (searchQuery) {
            result = result.filter(row =>
                headers.some(h => String(row[h] || '').toLowerCase().includes(searchQuery.toLowerCase()))
            );
        }
        return result;
    }, [data, headers, searchQuery]);

    // 2. Stable Sort Order (Indices)
    // Only re-calculates when sort params, search query, or row count changes.
    // Content changes (edits) will NOT trigger this, preventing rows from jumping.
    const rowOrder = useMemo(() => {
        const indices = filteredData.map((_, i) => i);

        if (sortColumn) {
            indices.sort((a, b) => {
                const rowA = filteredData[a];
                const rowB = filteredData[b];
                const aVal = String(rowA[sortColumn] || '');
                const bVal = String(rowB[sortColumn] || '');
                const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
                return sortDirection === 'asc' ? cmp : -cmp;
            });
        }

        return indices;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        sortColumn,
        sortDirection,
        filteredData.length,  // Only re-sort if row count changes (add/delete)
        searchQuery,          // Re-sort if filter changes
        // filteredData       // EXPLICITLY OMITTED to achieve stable sort during edits
    ]);

    // 3. Final Processed Data (Mapped from stable order to latest content)
    const processedData = useMemo(() => {
        return rowOrder.map(index => filteredData[index]).filter(Boolean);
    }, [rowOrder, filteredData]);

    // Filter out hidden columns but keep enrichment columns visible
    const visibleHeaders = useMemo(() =>
        headers.filter(h => isEnrichmentColumn(h) || !h.startsWith('__')),
        [headers]
    );

    // --- Hooks ---

    const {
        editingCell, setEditingCell,
        editValue, setEditValue,
        handleCellDoubleClick,
        saveEdit
    } = useGridEditing({
        processedData,
        headers,
        updateCell
    });

    const {
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
    } = useGridSelection({
        processedData,
        headers,
        visibleHeaders,
        editingCell,
        tableContainerRef
    });

    const {
        isFilling,
        fillStart,
        fillEnd,
        handleFillHandleMouseDown,
        handleFillMouseEnter
    } = useGridFill({
        processedData,
        visibleHeaders,
        updateCells,
        tableContainerRef
    });

    useGridClipboard({
        processedData,
        headers: visibleHeaders,
        selection,
        selectedCells,
        selectedRows,
        selectedColumns,
        editingCell,
        updateCell,
        tableContainerRef
    });

    // Resize state
    const [resizing, setResizing] = useState<{ col: string; startX: number; startWidth: number } | null>(null);
    const resizeLineRef = useRef<HTMLDivElement>(null);

    // Dialog states
    const [showAddColumn, setShowAddColumn] = useState(false);
    const [showMerge, setShowMerge] = useState(false);
    const [showTransform, setShowTransform] = useState(false);
    const [showTemplateColumn, setShowTemplateColumn] = useState(false);
    const [showAIColumn, setShowAIColumn] = useState(false);
    const [showApify, setShowApify] = useState(false);
    const [showReoonEmail, setShowReoonEmail] = useState(false);
    const [showSuccessAi, setShowSuccessAi] = useState(false);
    const [showSmartlead, setShowSmartlead] = useState(false);
    const [continueColumn, setContinueColumn] = useState<string | null>(null);
    const [showEnrichmentViewer, setShowEnrichmentViewer] = useState(false);
    const [enrichmentViewerRow, setEnrichmentViewerRow] = useState<number | null>(null);
    const [enrichmentViewerColumn, setEnrichmentViewerColumn] = useState<string>('');
    const [showExportDialog, setShowExportDialog] = useState(false);
    const [newColumnName, setNewColumnName] = useState('');
    const [editingColumn, setEditingColumn] = useState<string | null>(null);
    const [editingColumnValue, setEditingColumnValue] = useState('');

    // Column drag reorder state
    const [draggedColIdx, setDraggedColIdx] = useState<number | null>(null);
    const [dragOverColIdx, setDragOverColIdx] = useState<number | null>(null);

    // Update column widths when headers change
    useEffect(() => {
        setColumnWidths(prev => {
            const updated = { ...prev };
            headers.forEach(h => {
                if (!updated[h]) updated[h] = 150;
            });
            return updated;
        });
    }, [headers]);



    // Row virtualizer for performance with large datasets
    const rowVirtualizer = useVirtualizer({
        count: processedData.length,
        getScrollElement: () => tableContainerRef.current,
        estimateSize: () => 36, // Row height in px
        overscan: 10, // Render 10 extra rows above/below viewport for smooth scrolling
    });

    // Column resize handlers
    const handleResizeStart = useCallback((e: React.MouseEvent, col: string) => {
        e.preventDefault();
        e.stopPropagation();
        setResizing({ col, startX: e.clientX, startWidth: columnWidths[col] || 150 });

        // Show resize line immediately
        if (resizeLineRef.current) {
            resizeLineRef.current.style.display = 'block';
            resizeLineRef.current.style.left = `${e.clientX}px`;
        }
    }, [columnWidths]);

    // Double-click on resize handle to auto-fit column width
    const handleResizeDoubleClick = useCallback((col: string) => {
        // Calculate optimal width based on content
        const headerWidth = col.length * 8 + 80; // Approximate header width
        const contentWidths = data.slice(0, 50).map(row => {
            const val = String(row[col] || '');
            // Estimate: 7px per character, min 80, max 600
            return Math.min(600, Math.max(80, val.length * 7 + 20));
        });
        const maxContentWidth = Math.max(headerWidth, ...contentWidths);
        setColumnWidths(prev => ({ ...prev, [col]: maxContentWidth }));
    }, [data]);

    useEffect(() => {
        if (!resizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            // Only move the line, don't update state/render
            if (resizeLineRef.current) {
                resizeLineRef.current.style.left = `${e.clientX}px`;
            }
        };

        const handleMouseUp = (e: MouseEvent) => {
            // Calculate final width and update state once
            const diff = e.clientX - resizing.startX;
            const newWidth = Math.max(80, Math.min(1000, resizing.startWidth + diff));
            setColumnWidths(prev => ({ ...prev, [resizing.col]: newWidth }));
            setResizing(null);

            // Hide line
            if (resizeLineRef.current) {
                resizeLineRef.current.style.display = 'none';
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [resizing]);



    // Sort handler - separate from selection
    const handleSort = useCallback((col: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (sortColumn === col) {
            if (sortDirection === 'asc') {
                setSortDirection('desc');
            } else {
                setSortColumn(null);
            }
        } else {
            setSortColumn(col);
            setSortDirection('asc');
        }
    }, [sortColumn, sortDirection]);



    // Keyboard handling
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Skip if focus is in an input, textarea, or dialog
            const target = e.target as HTMLElement;
            const tagName = target.tagName.toLowerCase();
            const isInDialog = target.closest('[role="dialog"]') !== null;
            const isInputElement = tagName === 'input' || tagName === 'textarea' || target.isContentEditable;

            // Allow keyboard events in inputs/dialogs (except for our edit input)
            if (isInputElement || isInDialog) {
                // CellEditor handles Enter/Escape/Tab internally via onBlur/onKeyDown
                // Just let it handle the events
                return;
            }

            // If editing a cell, CellEditor component handles the keyboard events
            if (editingCell) {
                return;
            }

            // Check if we have any selection (range or individual cells)
            const hasRangeSelection = selection !== null;
            const hasIndividualCells = selectedCells.size > 0;

            if (!hasRangeSelection && !hasIndividualCells) return;

            // Copy - use standard TSV format for compatibility (reads from VISUAL order)
            if (e.ctrlKey && e.key === 'c') {
                e.preventDefault();

                if (hasIndividualCells) {
                    // Copy individually selected cells (Ctrl+Click selection)
                    // Sort cells by row, then column for consistent output
                    const cellList = Array.from(selectedCells).map(key => {
                        const [r, c] = key.split(',').map(Number);
                        return { visualRow: r, col: c };
                    }).sort((a, b) => a.visualRow - b.visualRow || a.col - b.col);

                    const values = cellList.map(({ visualRow, col }) => {
                        const row = processedData[visualRow];
                        if (!row) return '';
                        let val = row[headers[col]] || '';
                        if (val.includes('\t') || val.includes('\n') || val.includes('"')) {
                            val = `"${val.replace(/"/g, '""')}"`;
                        }
                        return val;
                    });

                    navigator.clipboard.writeText(values.join('\n'));
                    toast.success(`Copied ${selectedCells.size} cells`);
                } else if (hasRangeSelection) {
                    // Copy range selection
                    const minR = Math.min(selection!.start.row, selection!.end.row);
                    const maxR = Math.max(selection!.start.row, selection!.end.row);
                    const minC = Math.min(selection!.start.col, selection!.end.col);
                    const maxC = Math.max(selection!.start.col, selection!.end.col);

                    const lines: string[] = [];
                    for (let visualRow = minR; visualRow <= maxR; visualRow++) {
                        const row = processedData[visualRow];
                        if (!row) continue;
                        const rowCells: string[] = [];
                        for (let c = minC; c <= maxC; c++) {
                            let val = row[headers[c]] || '';
                            if (val.includes('\t') || val.includes('\n') || val.includes('"')) {
                                val = `"${val.replace(/"/g, '""')}"`;
                            }
                            rowCells.push(val);
                        }
                        lines.push(rowCells.join('\t'));
                    }

                    navigator.clipboard.writeText(lines.join('\n'));
                    toast.success(`Copied ${maxR - minR + 1} × ${maxC - minC + 1} cells`);
                }
            }

            // Cut (Ctrl+X) - Copy then clear cells
            if (e.ctrlKey && e.key === 'x') {
                e.preventDefault();

                if (hasIndividualCells) {
                    // Cut individually selected cells (Ctrl+Click selection)
                    const cellList = Array.from(selectedCells).map(key => {
                        const [r, c] = key.split(',').map(Number);
                        return { visualRow: r, col: c };
                    }).sort((a, b) => a.visualRow - b.visualRow || a.col - b.col);

                    // Copy to clipboard
                    const values = cellList.map(({ visualRow, col }) => {
                        const row = processedData[visualRow];
                        if (!row) return '';
                        let val = row[headers[col]] || '';
                        if (val.includes('\t') || val.includes('\n') || val.includes('"')) {
                            val = `"${val.replace(/"/g, '""')}"`;
                        }
                        return val;
                    });
                    navigator.clipboard.writeText(values.join('\n'));

                    // Clear the cells
                    const updates = cellList.map(({ visualRow, col }) => {
                        const originalRowIdx = processedData[visualRow]?.__idx;
                        return {
                            rowIndex: originalRowIdx,
                            header: headers[col],
                            value: ''
                        };
                    }).filter(u => u.rowIndex !== undefined) as { rowIndex: number; header: string; value: string }[];

                    if (updates.length > 0) {
                        updateCells(updates);
                    }

                    toast.success(`Cut ${selectedCells.size} cells`);
                    setSelectedCells(new Set());
                } else if (hasRangeSelection) {
                    // Cut range selection
                    const minR = Math.min(selection!.start.row, selection!.end.row);
                    const maxR = Math.max(selection!.start.row, selection!.end.row);
                    const minC = Math.min(selection!.start.col, selection!.end.col);
                    const maxC = Math.max(selection!.start.col, selection!.end.col);

                    // Copy to clipboard
                    const lines: string[] = [];
                    for (let visualRow = minR; visualRow <= maxR; visualRow++) {
                        const row = processedData[visualRow];
                        if (!row) continue;
                        const rowCells: string[] = [];
                        for (let c = minC; c <= maxC; c++) {
                            let val = row[headers[c]] || '';
                            if (val.includes('\t') || val.includes('\n') || val.includes('"')) {
                                val = `"${val.replace(/"/g, '""')}"`;
                            }
                            rowCells.push(val);
                        }
                        lines.push(rowCells.join('\t'));
                    }
                    navigator.clipboard.writeText(lines.join('\n'));

                    // Clear the cells
                    const updates: { rowIndex: number; header: string; value: string }[] = [];
                    for (let visualRow = minR; visualRow <= maxR; visualRow++) {
                        const originalRowIdx = processedData[visualRow]?.__idx;
                        if (originalRowIdx === undefined) continue;
                        for (let c = minC; c <= maxC; c++) {
                            updates.push({
                                rowIndex: originalRowIdx,
                                header: headers[c],
                                value: ''
                            });
                        }
                    }

                    if (updates.length > 0) {
                        updateCells(updates);
                    }

                    toast.success(`Cut ${maxR - minR + 1} × ${maxC - minC + 1} cells`);
                }
            }

            // Undo
            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (canUndo) {
                    undo();
                    toast.success('Undo');
                }
            }

            // Redo
            if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
                e.preventDefault();
                if (canRedo) {
                    redo();
                    toast.success('Redo');
                }
            }

            // Paste - only works with range selection (need a starting point)
            if (e.ctrlKey && e.key === 'v' && hasRangeSelection) {
                e.preventDefault();
                navigator.clipboard.readText().then(text => {
                    const startVisualR = Math.min(selection!.start.row, selection!.end.row);
                    const startC = Math.min(selection!.start.col, selection!.end.col);

                    let cellData: string[][];

                    const cleanText = text.replace(/\r\n/g, '\n');
                    const hasTabSeparators = cleanText.includes('\t');
                    const hasNewlines = cleanText.includes('\n');
                    const isSingleCellSelection = selection!.start.row === selection!.end.row &&
                        selection!.start.col === selection!.end.col;

                    if (!hasTabSeparators && !hasNewlines && isSingleCellSelection) {
                        const originalRowIdx = processedData[startVisualR]?.__idx;
                        if (originalRowIdx !== undefined) {
                            updateCell(originalRowIdx, headers[startC], cleanText);
                            toast.success('Pasted into cell');
                        }
                        return;
                    }

                    cellData = cleanText.split('\n')
                        .filter((line, idx, arr) => !(idx === arr.length - 1 && line === ''))
                        .map(line => {
                            return line.split('\t').map(cell => {
                                if (cell.startsWith('"') && cell.endsWith('"')) {
                                    return cell.slice(1, -1).replace(/""/g, '"');
                                }
                                return cell;
                            });
                        });

                    const pasteRowCount = cellData.length;
                    const pasteColCount = Math.max(...cellData.map(r => r.length));

                    // Calculate how many rows/columns need to be added
                    const currentRowCount = data.length;
                    const currentColCount = headers.length;
                    const neededRows = (startVisualR + pasteRowCount) - currentRowCount;
                    const neededCols = (startC + pasteColCount) - currentColCount;

                    // Add missing columns first
                    const newColNames: string[] = [];
                    for (let i = 0; i < neededCols; i++) {
                        const newColName = `Column ${currentColCount + i + 1}`;
                        newColNames.push(newColName);
                        addColumn(newColName, '');
                    }

                    // Add missing rows
                    for (let i = 0; i < neededRows; i++) {
                        addRow();
                    }

                    // Now paste the data - use setTimeout to ensure state updates have propagated
                    setTimeout(() => {
                        // Get fresh data from store after adding rows/columns
                        const freshState = useCSVStore.getState();
                        const freshData = freshState.data;
                        const freshHeaders = freshState.headers;

                        const updates: { rowIndex: number; header: string; value: string }[] = [];

                        cellData.forEach((rowCells, rOffset) => {
                            rowCells.forEach((val, cOffset) => {
                                const targetVisualRowIdx = startVisualR + rOffset;
                                const targetColIdx = startC + cOffset;
                                const targetHeader = freshHeaders[targetColIdx];

                                // For newly added rows, they're at the end of the data array
                                // For existing rows, we need to map visual index to original index
                                let targetOriginalIdx: number;

                                if (targetVisualRowIdx < processedData.length) {
                                    // Existing row - get original index from processedData
                                    targetOriginalIdx = processedData[targetVisualRowIdx]?.__idx;
                                } else {
                                    // Newly added row - it's at the end of the data array
                                    // New rows are added to the end, so they're at data.length - neededRows + offset
                                    const newRowOffset = targetVisualRowIdx - processedData.length;
                                    targetOriginalIdx = freshData.length - neededRows + newRowOffset;
                                }

                                if (targetHeader && targetOriginalIdx !== undefined && targetOriginalIdx < freshData.length) {
                                    updates.push({ rowIndex: targetOriginalIdx, header: targetHeader, value: val });
                                }
                            });
                        });

                        if (updates.length > 0) {
                            updateCells(updates);
                        }

                        toast.success(`Pasted ${pasteRowCount} × ${pasteColCount} cells${neededRows > 0 ? ` (+${neededRows} rows)` : ''}${neededCols > 0 ? ` (+${neededCols} columns)` : ''}`);
                    }, 50);
                });
            }

            // Delete - works with both selection types
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                const updates: { rowIndex: number; header: string; value: string }[] = [];

                if (hasIndividualCells) {
                    // Delete individually selected cells
                    selectedCells.forEach(key => {
                        const [visualRow, col] = key.split(',').map(Number);
                        const originalRowIdx = processedData[visualRow]?.__idx;
                        if (originalRowIdx !== undefined) {
                            updates.push({ rowIndex: originalRowIdx, header: headers[col], value: '' });
                        }
                    });
                } else if (hasRangeSelection) {
                    // Delete range selection
                    const minR = Math.min(selection!.start.row, selection!.end.row);
                    const maxR = Math.max(selection!.start.row, selection!.end.row);
                    const minC = Math.min(selection!.start.col, selection!.end.col);
                    const maxC = Math.max(selection!.start.col, selection!.end.col);

                    for (let visualRow = minR; visualRow <= maxR; visualRow++) {
                        const originalRowIdx = processedData[visualRow]?.__idx;
                        if (originalRowIdx === undefined) continue;
                        for (let c = minC; c <= maxC; c++) {
                            updates.push({ rowIndex: originalRowIdx, header: headers[c], value: '' });
                        }
                    }
                }

                if (updates.length > 0) {
                    updateCells(updates);
                    toast.success('Cleared selection');
                }
            }

            // Select All (Ctrl+A) - use processedData.length for visual rows
            if (e.ctrlKey && e.key === 'a') {
                e.preventDefault();
                setSelection({
                    mode: 'range',
                    start: { row: 0, col: 0 },
                    end: { row: processedData.length - 1, col: headers.length - 1 }
                });
                toast.success(`Selected all (${processedData.length} × ${headers.length})`);
            }

            // Arrow navigation and Enter to edit - require range selection
            if (hasRangeSelection) {
                const { row, col } = selection!.start;
                if (e.key === 'ArrowUp' && row > 0) {
                    setSelection({ mode: 'cell', start: { row: row - 1, col }, end: { row: row - 1, col } });
                } else if (e.key === 'ArrowDown' && row < processedData.length - 1) {
                    setSelection({ mode: 'cell', start: { row: row + 1, col }, end: { row: row + 1, col } });
                } else if (e.key === 'ArrowLeft' && col > 0) {
                    setSelection({ mode: 'cell', start: { row, col: col - 1 }, end: { row, col: col - 1 } });
                } else if (e.key === 'ArrowRight' && col < headers.length - 1) {
                    setSelection({ mode: 'cell', start: { row, col: col + 1 }, end: { row, col: col + 1 } });
                }

                // Enter to edit
                if (e.key === 'Enter') {
                    const val = processedData[selection!.start.row]?.[headers[selection!.start.col]] || '';
                    handleCellDoubleClick(selection!.start.row, selection!.start.col, String(val));
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [editingCell, selection, selectedCells, processedData, headers, updateCell, updateCells, handleCellDoubleClick, undo, redo, canUndo, canRedo]);

    // Add/delete handlers
    const handleAddColumn = useCallback(() => {
        if (!newColumnName.trim()) { toast.error('Enter a column name'); return; }
        addColumn(newColumnName.trim());
        setNewColumnName('');
        setShowAddColumn(false);
        toast.success(`Added column "${newColumnName.trim()}"`);
    }, [newColumnName, addColumn]);

    const handleDeleteColumn = useCallback((header: string) => {
        if (headers.length <= 1) { toast.error('Cannot delete last column'); return; }
        deleteColumn(header);
        toast.success(`Deleted "${header}"`);
    }, [headers.length, deleteColumn]);

    const handleExportCSV = useCallback(() => {
        setShowExportDialog(true);
    }, []);

    return (
        <div
            className="h-screen flex flex-col bg-background select-none"
            onClick={(e) => {
                // Deselect if clicking on empty background (main container)
                if (e.target === e.currentTarget) {
                    setSelection(null);
                    setSelectedRows(new Set());
                    setSelectedColumns(new Set());
                }
            }}
        >
            {/* Header */}
            <header className="flex-shrink-0 border-b bg-background/95 backdrop-blur z-50 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Layers className="w-6 h-6 text-primary" />
                        <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">LayerForge</h1>
                        <ThemeToggle />
                    </div>
                    <span className="text-sm text-muted-foreground">Data Editor • {data.length} × {headers.length}</span>
                </div>
                <div className="flex items-center gap-2">
                    {onReturnToDashboard && (
                        <Button variant="ghost" size="sm" onClick={onReturnToDashboard}>
                            ← Dashboard
                        </Button>
                    )}
                    <Button onClick={proceedToEditor}>Continue to Canvas<ArrowRight className="w-4 h-4 ml-2" /></Button>
                </div>
            </header>

            {/* Toolbar */}
            <div className="flex-shrink-0 border-b bg-muted/30 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"><Undo2 className="w-4 h-4" /></Button>
                    <Button variant="outline" size="sm" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)"><Redo2 className="w-4 h-4" /></Button>
                    <div className="w-px h-6 bg-border" />
                    <Button variant="outline" size="sm" onClick={() => { addRow(); toast.success('Row added'); }}><Plus className="w-4 h-4 mr-1" />Row</Button>
                    <Button variant="outline" size="sm" onClick={() => setShowAddColumn(true)}><Plus className="w-4 h-4 mr-1" />Column</Button>
                    <Button variant="outline" size="sm" onClick={() => setShowMerge(true)}><Merge className="w-4 h-4 mr-1" />Merge CSV</Button>
                    <Button variant="outline" size="sm" onClick={() => setShowTransform(true)}><Wand2 className="w-4 h-4 mr-1" />Transform</Button>
                    <Button variant="outline" size="sm" onClick={() => setShowTemplateColumn(true)}><FileText className="w-4 h-4 mr-1" />Template</Button>
                    <Button variant="outline" size="sm" onClick={() => setShowAIColumn(true)} className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border-purple-500/30 hover:border-purple-500/50">
                        <Sparkles className="w-4 h-4 mr-1 text-purple-500" />AI Column
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setShowApify(true)} className="bg-gradient-to-r from-orange-500/10 to-yellow-500/10 border-orange-500/30 hover:border-orange-500/50">
                        <Database className="w-4 h-4 mr-1 text-orange-500" />Run Apify
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setShowReoonEmail(true)} className="bg-gradient-to-r from-green-500/10 to-teal-500/10 border-green-500/30 hover:border-green-500/50">
                        <Mail className="w-4 h-4 mr-1 text-green-500" />Verify Emails
                    </Button>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border-blue-500/30 hover:border-blue-500/50 min-w-[160px] justify-between">
                                <span className="flex items-center text-blue-600 dark:text-blue-400">
                                    <Play className="w-4 h-4 mr-2" />
                                    Push to Campaign
                                </span>
                                <ChevronDown className="w-4 h-4 ml-2 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-1" align="end">
                            <div className="flex flex-col gap-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowSuccessAi(true)}
                                    className="justify-start font-normal"
                                >
                                    <img src="https://success.ai/favicon.ico" className="w-4 h-4 mr-2" alt="" onError={(e) => e.currentTarget.src = ''} />
                                    Success.ai
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowSmartlead(true)}
                                    className="justify-start font-normal"
                                >
                                    <Upload className="w-4 h-4 mr-2 text-purple-500" />
                                    Smartlead
                                </Button>
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>
                <div className="flex items-center gap-2">
                    {/* AI Processing indicator */}
                    {aiProcessing.isProcessing && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-purple-500/10 border border-purple-500/30 rounded-md">
                            <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                            <span className="text-sm text-purple-700 dark:text-purple-300">
                                {aiProcessing.columnName}: {aiProcessing.processedCount}/{aiProcessing.totalCount}
                            </span>
                            <Button
                                variant="destructive"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => aiProcessingState.cancel()}
                            >
                                Cancel
                            </Button>
                        </div>
                    )}
                    {/* Apify Processing indicator */}
                    {apifyProcessing.isProcessing && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-orange-500/10 border border-orange-500/30 rounded-md">
                            <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
                            <span className="text-sm text-orange-700 dark:text-orange-300">
                                {apifyProcessing.actorName}: {apifyProcessing.processedCount}/{apifyProcessing.totalCount}
                            </span>
                            <Button
                                variant="destructive"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => apifyProcessingState.cancel()}
                            >
                                Cancel
                            </Button>
                        </div>
                    )}
                    {/* Reoon Processing indicator */}
                    {reoonProcessing.isProcessing && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 border border-green-500/30 rounded-md">
                            <Loader2 className="w-4 h-4 animate-spin text-green-500" />
                            <span className="text-sm text-green-700 dark:text-green-300">
                                Verifying: {reoonProcessing.processedCount}/{reoonProcessing.totalCount}
                            </span>
                            <Button
                                variant="destructive"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => reoonProcessingState.cancel()}
                            >
                                Cancel
                            </Button>
                        </div>
                    )}
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-8 w-48 h-8" />
                    </div>
                    <Button variant="outline" size="sm" onClick={handleExportCSV}><Download className="w-4 h-4 mr-1" />Export</Button>
                </div>
            </div>

            {/* Resize Line Indicator */}
            <div
                ref={resizeLineRef}
                className="fixed top-0 bottom-0 w-0.5 bg-blue-500 z-50 pointer-events-none hidden"
                style={{ display: 'none' }}
            />

            {/* Grid-based Table with Virtualization */}
            <div
                ref={tableContainerRef}
                className="flex-1 overflow-auto"
                onClick={(e) => {
                    if (e.target === e.currentTarget) {
                        setSelection(null);
                        setSelectedRows(new Set());
                        setSelectedColumns(new Set());
                    }
                }}
            >
                <div style={{ minWidth: 'max-content' }}>
                    {/* Header Row - Sticky */}
                    <div className="flex sticky top-0 z-20 csv-editor-thead" style={{ minWidth: 'max-content' }}>
                        <div className="csv-editor-header border-r px-2 py-1.5 text-xs w-12 text-center sticky left-0 z-30 flex-shrink-0">#</div>
                        {visibleHeaders.map((h, colIdx) => {
                            const aiConfig = getAIColumnConfig(h);
                            const unprocessedCount = aiConfig ? getUnprocessedRowCount(h, data.length) : 0;
                            const isAI = isAIColumn(h);
                            const isEnrichment = isEnrichmentColumn(h);
                            const actorId = isEnrichment ? getActorIdFromColumn(h) : null;
                            const enrichDisplayName = actorId ? getEnrichmentDisplayName(actorId) : h;

                            return (
                                <div
                                    key={h}
                                    draggable={!editingColumn}
                                    onDragStart={(e) => {
                                        setDraggedColIdx(colIdx);
                                        e.dataTransfer.effectAllowed = 'move';
                                        e.dataTransfer.setData('text/plain', String(colIdx));
                                        // Make the drag image slightly transparent
                                        if (e.currentTarget) {
                                            e.currentTarget.style.opacity = '0.5';
                                        }
                                    }}
                                    onDragEnd={(e) => {
                                        setDraggedColIdx(null);
                                        setDragOverColIdx(null);
                                        if (e.currentTarget) {
                                            e.currentTarget.style.opacity = '1';
                                        }
                                    }}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.dataTransfer.dropEffect = 'move';
                                        if (draggedColIdx !== null && colIdx !== draggedColIdx) {
                                            setDragOverColIdx(colIdx);
                                        }
                                    }}
                                    onDragLeave={() => {
                                        if (dragOverColIdx === colIdx) {
                                            setDragOverColIdx(null);
                                        }
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        if (draggedColIdx !== null && draggedColIdx !== colIdx) {
                                            reorderColumns(draggedColIdx, colIdx);
                                        }
                                        setDraggedColIdx(null);
                                        setDragOverColIdx(null);
                                    }}
                                    className={`csv-editor-header border-r text-xs text-left relative group cursor-grab flex-shrink-0 ${draggedColIdx === colIdx ? 'opacity-50' : ''} ${dragOverColIdx === colIdx ? 'border-l-2 border-l-primary' : ''} ${isAI ? 'bg-gradient-to-r from-purple-500/10 to-blue-500/10' : ''} ${isEnrichment ? 'bg-gradient-to-r from-purple-500/10 to-pink-500/10' : ''} ${selectedColumns.has(h) ? 'bg-primary/20' :
                                        (selection?.mode === 'column' &&
                                            colIdx >= Math.min(selection.start.col, selection.end.col) &&
                                            colIdx <= Math.max(selection.start.col, selection.end.col) ? 'selected' : '')
                                        }`}
                                    style={{ width: columnWidths[h], minWidth: 80 }}
                                    onClick={(e) => handleColumnHeaderClick(colIdx, e)}
                                >
                                    <div className="flex items-center justify-between px-2 py-1.5">
                                        {editingColumn === h ? (
                                            <input
                                                type="text"
                                                value={editingColumnValue}
                                                onChange={(e) => setEditingColumnValue(e.target.value)}
                                                onBlur={() => {
                                                    if (editingColumnValue.trim() && editingColumnValue !== h) {
                                                        renameColumn(h, editingColumnValue.trim());
                                                    }
                                                    setEditingColumn(null);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        if (editingColumnValue.trim() && editingColumnValue !== h) {
                                                            renameColumn(h, editingColumnValue.trim());
                                                        }
                                                        setEditingColumn(null);
                                                    } else if (e.key === 'Escape') {
                                                        setEditingColumn(null);
                                                    }
                                                }}
                                                className="bg-background border border-primary px-1 py-0.5 text-xs w-full rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                                autoFocus
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        ) : (
                                            <span
                                                className="truncate flex-1 flex items-center gap-1 cursor-text"
                                                onDoubleClick={(e) => {
                                                    if (!isEnrichment && !isAI) {
                                                        e.stopPropagation();
                                                        setEditingColumn(h);
                                                        setEditingColumnValue(h);
                                                    }
                                                }}
                                                title={isEnrichment || isAI ? undefined : "Double-click to rename"}
                                            >
                                                {isAI && <Sparkles className="w-3 h-3 text-purple-500 flex-shrink-0" />}
                                                {isEnrichment ? (
                                                    <>{enrichDisplayName}</>
                                                ) : (
                                                    <>{String.fromCharCode(65 + colIdx % 26)}: {h}</>
                                                )}
                                            </span>
                                        )}
                                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                                            {/* Play button for AI columns with remaining rows */}
                                            {isAI && unprocessedCount > 0 && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (aiConfig) {
                                                            setContinueColumn(h);
                                                            setShowAIColumn(true);
                                                        }
                                                    }}
                                                    className="p-0.5 rounded hover:bg-purple-500/20 text-purple-500 relative"
                                                    title={`Process ${unprocessedCount} more rows`}
                                                >
                                                    <Play className="w-3 h-3 fill-current" />
                                                    <span className="absolute -top-1 -right-1 bg-purple-500 text-white text-[8px] rounded-full w-3 h-3 flex items-center justify-center">
                                                        {unprocessedCount > 99 ? '99+' : unprocessedCount}
                                                    </span>
                                                </button>
                                            )}
                                            <button onClick={(e) => handleSort(h, e)} className={`p-0.5 rounded hover:bg-accent ${sortColumn === h ? 'text-primary opacity-100' : ''}`} title="Sort">
                                                {sortColumn === h ? (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUp className="w-3 h-3 opacity-50" />}
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); handleDeleteColumn(h); }} className="p-0.5 rounded hover:bg-destructive/20 text-destructive" title="Delete"><X className="w-3 h-3" /></button>
                                        </div>
                                    </div>
                                    {/* Resize handle - double click to auto-fit */}
                                    <div
                                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary z-10 flex items-center justify-center"
                                        onMouseDown={(e) => handleResizeStart(e, h)}
                                        onDoubleClick={(e) => { e.stopPropagation(); handleResizeDoubleClick(h); }}
                                        onClick={(e) => e.stopPropagation()}
                                        title="Drag to resize, double-click to auto-fit"
                                    >
                                        <GripVertical className="w-2 h-2 text-muted-foreground/30" />
                                    </div>
                                </div>
                            )
                        })}
                        <div className="csv-editor-header w-10 flex-shrink-0"></div>
                    </div>

                    {/* Virtualized Body */}
                    <div
                        style={{
                            height: `${rowVirtualizer.getTotalSize()}px`,
                            width: '100%',
                            position: 'relative',
                        }}
                    >
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                            const displayIdx = virtualRow.index;
                            const row = processedData[displayIdx];
                            const originalRowIdx = row.__idx;
                            // Check if this row contains the editing cell
                            const hasEditingCell = editingCell?.row === displayIdx;
                            return (
                                <div
                                    key={originalRowIdx}
                                    className="flex group bg-background"
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        height: `${virtualRow.size}px`,
                                        transform: `translateY(${virtualRow.start}px)`,
                                        zIndex: hasEditingCell ? 100 : 1,
                                    }}
                                >
                                    <div
                                        className={`csv-editor-row-num border-b px-2 py-1 text-xs text-center sticky left-0 z-10 cursor-pointer w-12 flex-shrink-0 flex items-center justify-center ${selectedRows.has(originalRowIdx) ? 'bg-primary text-primary-foreground' :
                                            (selection && displayIdx >= Math.min(selection.start.row, selection.end.row) && displayIdx <= Math.max(selection.start.row, selection.end.row) ? 'selected' : '')
                                            }`}
                                        onClick={(e) => handleRowClick(originalRowIdx, e)}
                                    >
                                        {displayIdx + 1}
                                    </div>
                                    {visibleHeaders.map((h, colIdx) => {
                                        const isSelected = isCellSelected(displayIdx, colIdx);
                                        const isEditing = editingCell?.row === displayIdx && editingCell?.col === colIdx;

                                        // Check if this cell should show fill handle (bottom-right of selection)
                                        // Note: Logic allows fill handle only on single cell or bottom-right of range
                                        const showFillHandle = !isEditing && isSelected &&
                                            selection?.mode === 'cell' &&
                                            selection.end.row === displayIdx &&
                                            selection.end.col === colIdx;

                                        // Check if this cell is in fill preview range
                                        const isInFillRange = isFilling && fillStart && fillEnd !== null &&
                                            colIdx === fillStart.col &&
                                            displayIdx >= Math.min(fillStart.row, fillEnd) &&
                                            displayIdx <= Math.max(fillStart.row, fillEnd) &&
                                            displayIdx !== fillStart.row;

                                        // Type guard for isInFillRange to ensure boolean
                                        const isFillingRangeBool = Boolean(isInFillRange);

                                        return (
                                            <GridCell
                                                key={h}
                                                header={h}
                                                row={row}
                                                colIdx={colIdx}
                                                displayIdx={displayIdx}
                                                width={columnWidths[h]}
                                                isSelected={isSelected}
                                                isEditing={isEditing}
                                                isInFillRange={isFillingRangeBool}
                                                showFillHandle={Boolean(showFillHandle)}
                                                editValue={editValue}
                                                onSaveEdit={saveEdit}
                                                onCancelEdit={() => setEditingCell(null)}
                                                onMouseDown={handleCellMouseDown}
                                                onMouseEnter={handleCellMouseEnter}
                                                onFillMouseEnter={handleFillMouseEnter}
                                                onDoubleClick={handleCellDoubleClick}
                                                onFillHandleMouseDown={handleFillHandleMouseDown}
                                                onViewEnrichment={(r, c) => {
                                                    setEnrichmentViewerRow(r);
                                                    setEnrichmentViewerColumn(c);
                                                    setShowEnrichmentViewer(true);
                                                }}
                                            />
                                        );
                                    })}
                                    <div className="border-b p-0 w-10 flex-shrink-0">
                                        <button onClick={() => { deleteRow(originalRowIdx); toast.success('Deleted'); }} className="w-full h-full p-1 text-destructive opacity-0 group-hover:opacity-100 hover:bg-destructive/10 flex items-center justify-center">
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Batch Actions Bar */}
            {
                selectedRows.size > 0 && (
                    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-popover border shadow-lg rounded-lg p-2 flex items-center gap-2 animate-in slide-in-from-bottom-2 fade-in z-50">
                        <span className="text-sm font-medium px-2">{selectedRows.size} selected</span>
                        <div className="h-4 w-px bg-border mx-1" />
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                // Convert Set items to sorted array strings, e.g. "1, 2, 5"
                                const rows = Array.from(selectedRows).map(r => r + 1).sort((a, b) => a - b).join(', ');
                                setNewColumnName(''); // Reset
                                setShowAIColumn(true);
                            }}
                        >
                            <Sparkles className="w-4 h-4 mr-2" />
                            Run AI
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                                // Delete all selected rows at once for single undo
                                deleteRows(Array.from(selectedRows));
                                setSelectedRows(new Set());
                                toast.success(`Deleted ${selectedRows.size} rows`);
                            }}
                        >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 ml-2" onClick={() => setSelectedRows(new Set())}>
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                )
            }

            {/* Batch Actions Bar (Columns) */}
            {
                selectedColumns.size > 0 && (
                    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-popover border shadow-lg rounded-lg p-2 flex items-center gap-2 animate-in slide-in-from-bottom-2 fade-in z-50">
                        <span className="text-sm font-medium px-2">{selectedColumns.size} cols selected</span>
                        <div className="h-4 w-px bg-border mx-1" />
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                                // Delete all selected columns at once for single undo
                                deleteColumns(Array.from(selectedColumns));
                                setSelectedColumns(new Set());
                                toast.success(`Deleted ${selectedColumns.size} columns`);
                            }}
                        >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete Columns
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 ml-2" onClick={() => setSelectedColumns(new Set())}>
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                )
            }

            {/* Status */}
            <div className="flex-shrink-0 border-t bg-muted/30 px-4 py-1 text-xs text-muted-foreground flex justify-between">
                <span>{selection ? `Selected ${Math.abs(selection.end.row - selection.start.row) + 1} × ${Math.abs(selection.end.col - selection.start.col) + 1}` : 'Click to select, Shift+click for range'} • Ctrl+A/C/V/Z</span>
                <span>{searchQuery && `${processedData.length}/${data.length} rows • `}{sortColumn && `Sorted by ${sortColumn} • `}{data.length} rows × {headers.length} cols</span>
            </div>

            {/* Add Column Dialog */}
            <Dialog open={showAddColumn} onOpenChange={setShowAddColumn}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Add Column</DialogTitle><DialogDescription>Enter column name</DialogDescription></DialogHeader>
                    <Input value={newColumnName} onChange={e => setNewColumnName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddColumn()} placeholder="column_name" autoFocus />
                    <DialogFooter><Button variant="ghost" onClick={() => setShowAddColumn(false)}>Cancel</Button><Button onClick={handleAddColumn}>Add</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Merge CSV Dialog */}
            <MergeCSVDialog open={showMerge} onOpenChange={setShowMerge} />

            {/* Transform Column Dialog */}
            <TransformColumnDialog
                open={showTransform}
                onOpenChange={setShowTransform}
                displayOrder={processedData.map(row => row.__idx)}
            />

            {/* Template Column Dialog */}
            <TemplateColumnDialog
                open={showTemplateColumn}
                onOpenChange={setShowTemplateColumn}
                displayOrder={processedData.map(row => row.__idx)}
            />

            {/* AI Column Dialog */}
            <AIColumnDialog
                open={showAIColumn}
                onOpenChange={(open) => {
                    setShowAIColumn(open);
                    if (!open) setContinueColumn(null);  // Clear continue mode when dialog closes
                }}
                displayOrder={processedData.map(row => row.__idx)}
                initialRowRange={showAIColumn && selectedRows.size > 0 ? Array.from(selectedRows).map(r => r + 1).sort((a, b) => a - b).join(', ') : ''}
                continueColumnName={continueColumn || undefined}
            />

            {/* Apify Dialog */}
            <ApifyDialog
                open={showApify}
                onOpenChange={setShowApify}
                displayOrder={processedData.map(row => row.__idx)}
                initialRowRange={showApify && selectedRows.size > 0 ? Array.from(selectedRows).map(r => r + 1).sort((a, b) => a - b).join(', ') : ''}
            />

            {/* Reoon Email Verification Dialog */}
            <ReoonEmailDialog
                open={showReoonEmail}
                onOpenChange={setShowReoonEmail}
                displayOrder={processedData.map(row => row.__idx)}
                initialRowRange={showReoonEmail && selectedRows.size > 0 ? Array.from(selectedRows).map(r => r + 1).sort((a, b) => a - b).join(', ') : ''}
            />

            {/* Success.ai Dialog */}
            <SuccessAiDialog
                open={showSuccessAi}
                onOpenChange={setShowSuccessAi}
                displayOrder={processedData.map(row => row.__idx)}
            />

            {/* Smartlead Dialog */}
            <SmartleadDialog
                open={showSmartlead}
                onOpenChange={setShowSmartlead}
                displayOrder={processedData.map(row => row.__idx)}
            />

            {/* Enrichment Viewer Dialog */}
            <EnrichmentViewerDialog
                open={showEnrichmentViewer}
                onOpenChange={setShowEnrichmentViewer}
                enrichment={enrichmentViewerRow !== null && enrichmentViewerColumn ? getEnrichmentFromColumn(data[enrichmentViewerRow] || {}, enrichmentViewerColumn) : null}
                rowIndex={enrichmentViewerRow ?? 0}
                enrichmentColumn={enrichmentViewerColumn}
            />


            {/* Export Dialog */}
            <ExportDialog
                open={showExportDialog}
                onOpenChange={setShowExportDialog}
            />
        </div >
    );
}
