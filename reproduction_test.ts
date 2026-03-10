import { strict as assert } from 'assert';

// Mock data and types
type ProcessedRow = { [key: string]: any; __idx: number };

// Logic extracted from useGridFill.ts
function simulateDragFill(
    processedData: ProcessedRow[],
    visibleHeaders: string[],
    dragStartVisualRow: number,
    dragStartColIdx: number,
    dragEndVisualRow: number
) {
    const colName = visibleHeaders[dragStartColIdx];
    const sourceRow = processedData[dragStartVisualRow];
    const sourceValue = sourceRow[colName];

    const updates: { rowIndex: number; header: string; value: string }[] = [];

    const startRow = Math.min(dragStartVisualRow, dragEndVisualRow);
    const endRow = Math.max(dragStartVisualRow, dragEndVisualRow);

    console.log(`Dragging from visual ${dragStartVisualRow} to ${dragEndVisualRow}`);
    console.log(`Range: ${startRow} to ${endRow}`);
    console.log(`Source Value: "${sourceValue}" (from original idx ${sourceRow.__idx})`);

    for (let row = startRow; row <= endRow; row++) {
        if (row !== dragStartVisualRow) { // Don't overwrite source
            const targetRow = processedData[row];
            const originalRowIdx = targetRow?.__idx;

            console.log(`Updating Visual Row ${row} (Original Idx ${originalRowIdx}). Value: ${targetRow[colName]} -> ${sourceValue}`);

            if (originalRowIdx !== undefined) {
                updates.push({
                    rowIndex: originalRowIdx,
                    header: colName,
                    value: sourceValue
                });
            }
        }
    }
    return updates;
}

// Test Case
function runTest() {
    // 1. Setup Data
    // Original Data: 
    // Idx 0: { name: "Bob", value: "B" }
    // Idx 1: { name: "Alice", value: "A" }
    // Idx 2: { name: "Charlie", value: "C" }

    // Sorted by Name (Alice, Bob, Charlie)
    // Visual 0: Idx 1 (Alice)
    // Visual 1: Idx 0 (Bob)
    // Visual 2: Idx 2 (Charlie)

    const visibleHeaders = ["name", "value"];

    const processedData: ProcessedRow[] = [
        { name: "Alice", value: "A", __idx: 1 },
        { name: "Bob", value: "B", __idx: 0 },
        { name: "Charlie", value: "C", __idx: 2 },
    ];

    console.log("--- Test: Drag Fill on Sorted List ---");
    // User drags from Alice (Visual 0) down to Bob (Visual 1).
    // Should copy Alice's "value" ("A") to Bob.
    // Result should be: Bob's value becomes "A".

    const updates = simulateDragFill(processedData, visibleHeaders, 0, 1, 1);

    // Expect: 1 update. 
    // Target: Original Idx 0 (Bob).
    // Value: "A".

    assert.equal(updates.length, 1, "Should have 1 update");
    assert.equal(updates[0].rowIndex, 0, "Should update original index 0 (Bob)");
    assert.equal(updates[0].value, "A", "Should update with source value 'A'");
    assert.equal(updates[0].header, "value", "Should update 'value' column");

    console.log("SUCCESS: Updates are correct.");
}

runTest();
