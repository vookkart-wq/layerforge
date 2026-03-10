/**
 * Parse row range string like "1-10, 15, 20-25" into row indices (0-based)
 * @param rangeStr - String like "1-5, 10, 15-20"
 * @param maxRows - Maximum number of rows (for validation)
 * @returns Array of 0-indexed row numbers
 */
export function parseRowRange(rangeStr: string, maxRows: number): number[] {
    if (!rangeStr.trim()) return [];

    const indices = new Set<number>();
    const parts = rangeStr.split(',').map(p => p.trim());

    for (const part of parts) {
        if (part.includes('-')) {
            // Range like "1-5"
            const [start, end] = part.split('-').map(s => parseInt(s.trim()));
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) {
                    if (i >= 1 && i <= maxRows) {
                        indices.add(i - 1); // Convert to 0-indexed
                    }
                }
            }
        } else {
            // Single number like "10"
            const num = parseInt(part);
            if (!isNaN(num) && num >= 1 && num <= maxRows) {
                indices.add(num - 1); // Convert to 0-indexed
            }
        }
    }

    return Array.from(indices).sort((a, b) => a - b);
}
