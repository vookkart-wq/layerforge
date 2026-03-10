import { memo } from 'react';
import { Sparkles } from 'lucide-react';
import { CellEditor } from './CellEditor';
import { LinkCell } from './LinkCell';
import { isEnrichmentColumn } from '@/services/apifyService';
import type { CellPosition } from './hooks/useGridEditing';

interface GridCellProps {
    // Data
    header: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    row: { [key: string]: any; __idx: number };
    colIdx: number;
    displayIdx: number;
    width: number;

    // State
    isSelected: boolean;
    isEditing: boolean;
    isInFillRange: boolean;
    showFillHandle: boolean;

    // Editing
    editValue: string;
    onSaveEdit: (val: string) => void;
    onCancelEdit: () => void;

    // Interaction Handlers
    onMouseDown: (displayIdx: number, colIdx: number, e: React.MouseEvent) => void;
    onMouseEnter: (displayIdx: number, colIdx: number) => void;
    onFillMouseEnter: (displayIdx: number) => void;
    onDoubleClick: (displayIdx: number, colIdx: number, value: string) => void;
    onFillHandleMouseDown: (displayIdx: number, colIdx: number, value: string, e: React.MouseEvent) => void;

    // Enrichment Actions
    onViewEnrichment: (rowIdx: number, col: string) => void;
}

export const GridCell = memo(function GridCell({
    header,
    row,
    colIdx,
    displayIdx,
    width,
    isSelected,
    isEditing,
    isInFillRange,
    showFillHandle,
    editValue,
    onSaveEdit,
    onCancelEdit,
    onMouseDown,
    onMouseEnter,
    onFillMouseEnter,
    onDoubleClick,
    onFillHandleMouseDown,
    onViewEnrichment
}: GridCellProps) {
    const originalRowIdx = row.__idx;
    const cellValue = String(row[header] || '');

    return (
        <div
            className={`border-b border-r flex-shrink-0 flex items-center relative ${isEditing ? 'overflow-visible z-50' : 'overflow-hidden'} ${isSelected ? 'bg-primary/10' : ''} ${isInFillRange ? 'bg-blue-200/50 border-blue-400' : ''}`}
            style={{ width, height: '100%' }}
            onMouseDown={(e) => onMouseDown(displayIdx, colIdx, e)}
            onMouseEnter={() => {
                onMouseEnter(displayIdx, colIdx);
                onFillMouseEnter(displayIdx);
            }}
            onDoubleClick={() => onDoubleClick(displayIdx, colIdx, cellValue)}
        >
            {isEditing ? (
                <CellEditor
                    initialValue={editValue}
                    onSave={onSaveEdit}
                    onCancel={onCancelEdit}
                />
            ) : isEnrichmentColumn(header) && row[header] ? (
                <div
                    className="px-2 py-1 text-sm cursor-pointer hover:bg-purple-500/10 flex items-center gap-2 h-full"
                    onClick={() => onViewEnrichment(originalRowIdx, header)}
                    title="Click to view and extract enrichment data"
                >
                    <Sparkles className="w-4 h-4 text-purple-500" />
                    <span className="text-purple-600">
                        {(() => {
                            try {
                                const enrichment = JSON.parse(row[header] as string);
                                const fieldCount = Object.keys(enrichment.data || {}).length;
                                return `${fieldCount} fields`;
                            } catch {
                                return '✓ Enriched';
                            }
                        })()}
                    </span>
                </div>
            ) : (
                <LinkCell
                    value={cellValue}
                    isSelected={isSelected}
                />
            )}

            {/* Fill Handle - small blue square at bottom-right of selected cell */}
            {showFillHandle && (
                <div
                    className="absolute bottom-0 right-0 w-2 h-2 bg-primary cursor-crosshair z-20 hover:scale-150 transition-transform"
                    style={{ transform: 'translate(50%, 50%)' }}
                    onMouseDown={(e) => onFillHandleMouseDown(displayIdx, colIdx, cellValue, e)}
                    title="Drag to fill cells below"
                />
            )}
        </div>
    );
});
