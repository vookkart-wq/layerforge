import { useState, useRef, useCallback, useEffect } from 'react';

// Type for processed row with original index
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProcessedRow = { [key: string]: any; __idx: number };

interface UseGridFillProps {
    processedData: ProcessedRow[];
    visibleHeaders: string[];
    updateCells: (updates: { rowIndex: number; header: string; value: string }[]) => void;
    tableContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function useGridFill({ processedData, visibleHeaders, updateCells, tableContainerRef }: UseGridFillProps) {
    // Fill handle state
    const [isFilling, setIsFilling] = useState(false);
    const isFillingRef = useRef(false); // Track in ref for animation frame callbacks
    const [fillStart, setFillStart] = useState<{ row: number; col: number } | null>(null);
    const [fillEnd, setFillEnd] = useState<number | null>(null); // Just the row since we fill down

    // Refs for closure-safe access during drag
    const fillStartRef = useRef<{ row: number; col: number } | null>(null);
    const fillEndRef = useRef<number | null>(null);
    const fillSourceValueRef = useRef<string>('');
    const autoScrollIntervalRef = useRef<number | null>(null);

    // Fill handle - start fill operation
    const handleFillHandleMouseDown = useCallback((visualRowIdx: number, colIdx: number, value: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        setIsFilling(true);
        isFillingRef.current = true;

        const startPos = { row: visualRowIdx, col: colIdx };
        setFillStart(startPos);
        setFillEnd(visualRowIdx);

        // Update refs
        fillStartRef.current = startPos;
        fillEndRef.current = visualRowIdx;
        fillSourceValueRef.current = value;
    }, []);

    // Track fill row during drag
    const handleFillMouseEnter = useCallback((visualRowIdx: number) => {
        if (isFilling) {
            setFillEnd(visualRowIdx);
            fillEndRef.current = visualRowIdx;
        }
    }, [isFilling]);

    // Fill handle - track mouse during fill and handle auto-scroll
    useEffect(() => {
        if (!isFilling) return;

        const handleMouseMove = (e: MouseEvent) => {
            const container = tableContainerRef.current;
            if (!container) return;

            const containerRect = container.getBoundingClientRect();
            const mouseY = e.clientY;

            // Auto-scroll when near edges
            const scrollThreshold = 50;
            const scrollSpeed = 8;

            // Clear existing auto-scroll
            if (autoScrollIntervalRef.current) {
                cancelAnimationFrame(autoScrollIntervalRef.current);
                autoScrollIntervalRef.current = null;
            }

            // Near bottom - scroll down
            if (mouseY > containerRect.bottom - scrollThreshold) {
                const scroll = () => {
                    if (isFillingRef.current && container) {
                        container.scrollTop += scrollSpeed;
                        autoScrollIntervalRef.current = requestAnimationFrame(scroll);
                    }
                };
                autoScrollIntervalRef.current = requestAnimationFrame(scroll);
            }
            // Near top - scroll up
            else if (mouseY < containerRect.top + scrollThreshold + 36) { // +36 for header
                const scroll = () => {
                    if (isFillingRef.current && container) {
                        container.scrollTop -= scrollSpeed;
                        autoScrollIntervalRef.current = requestAnimationFrame(scroll);
                    }
                };
                autoScrollIntervalRef.current = requestAnimationFrame(scroll);
            }
        };

        const handleMouseUp = () => {
            // Stop auto-scroll
            if (autoScrollIntervalRef.current) {
                cancelAnimationFrame(autoScrollIntervalRef.current);
                autoScrollIntervalRef.current = null;
            }

            // prevent double-firing or running if not filling
            if (!isFillingRef.current) return;
            isFillingRef.current = false; // Mark complete immediately

            // Use refs for closure-safe access to current values
            const currentFillStart = fillStartRef.current;
            const currentFillEnd = fillEndRef.current;

            // Apply fill using batch update for proper undo
            if (currentFillStart && currentFillEnd !== null && currentFillEnd !== currentFillStart.row) {
                const startRow = Math.min(currentFillStart.row, currentFillEnd);
                const endRow = Math.max(currentFillStart.row, currentFillEnd);
                const colName = visibleHeaders[currentFillStart.col];

                // Collect all updates for batch operation
                const updates: { rowIndex: number; header: string; value: string }[] = [];
                for (let row = startRow; row <= endRow; row++) {
                    if (row !== currentFillStart.row) { // Don't overwrite source
                        const originalRowIdx = processedData[row]?.__idx;
                        if (originalRowIdx !== undefined) {
                            updates.push({
                                rowIndex: originalRowIdx,
                                header: colName,
                                value: fillSourceValueRef.current
                            });
                        }
                    }
                }
                // Batch update - single undo entry
                if (updates.length > 0) {
                    updateCells(updates);
                }
            }

            // Reset other state and refs
            fillStartRef.current = null;
            fillEndRef.current = null;
            setIsFilling(false);
            setFillStart(null);
            setFillEnd(null);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            if (autoScrollIntervalRef.current) {
                cancelAnimationFrame(autoScrollIntervalRef.current);
            }
        };
    }, [isFilling, visibleHeaders, processedData, updateCells, tableContainerRef]); // Only depend on isFilling for setup/teardown

    return {
        isFilling,
        fillStart,
        fillEnd,
        handleFillHandleMouseDown,
        handleFillMouseEnter
    };
}
