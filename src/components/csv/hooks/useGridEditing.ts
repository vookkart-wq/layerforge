import { useState, useCallback } from 'react';

export interface CellPosition { row: number; col: number; }

// Type for processed row with original index
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProcessedRow = { [key: string]: any; __idx: number };

interface UseGridEditingProps {
    processedData: ProcessedRow[];
    headers: string[];
    updateCell: (rowIndex: number, header: string, value: string) => void;
}

export function useGridEditing({ processedData, headers, updateCell }: UseGridEditingProps) {
    const [editingCell, setEditingCell] = useState<CellPosition | null>(null);
    const [editValue, setEditValue] = useState(''); // Only used for initial value passing

    // Double click to edit (uses VISUAL indices)
    const handleCellDoubleClick = useCallback((visualRowIdx: number, colIdx: number, initialValue: string) => {
        setEditingCell({ row: visualRowIdx, col: colIdx });
        setEditValue(initialValue || '');
    }, []);

    // Save edit - map visual index to original for data operation  
    const saveEdit = useCallback((newValue: string) => {
        if (editingCell) {
            const originalRowIdx = processedData[editingCell.row]?.__idx;
            // Guard against invalid row/col
            if (originalRowIdx !== undefined && headers[editingCell.col]) {
                updateCell(originalRowIdx, headers[editingCell.col], newValue);
            }
            setEditingCell(null);
        }
    }, [editingCell, updateCell, headers, processedData]);

    return {
        editingCell, setEditingCell,
        editValue, setEditValue,
        handleCellDoubleClick,
        saveEdit
    };
}
