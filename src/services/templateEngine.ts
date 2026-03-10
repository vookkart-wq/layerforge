/**
 * Template Parser for CSV variable interpolation
 * Supports {{column_name}} syntax for dynamic text
 */

const VARIABLE_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;

/**
 * Parse a template string and replace variables with actual CSV row data
 */
export function parseTemplate(template: string, rowData: Record<string, string>): string {
    return template.replace(VARIABLE_PATTERN, (match, rawKey) => {
        const key = String(rawKey).trim();

        // Direct match
        if (rowData && Object.prototype.hasOwnProperty.call(rowData, key)) {
            return rowData[key] ?? '';
        }

        // Case-insensitive fallback
        const normalized = key.toLowerCase().replace(/\s+/g, '');
        const found = Object.keys(rowData || {}).find(
            k => k.toLowerCase().replace(/\s+/g, '') === normalized
        );

        return found ? (rowData[found] ?? '') : '';
    });
}

/**
 * Extract all variable names from a template
 */
export function extractVariables(template: string): string[] {
    const matches = template.matchAll(VARIABLE_PATTERN);
    return Array.from(matches, m => m[1].trim());
}

/**
 * Validate that all variables in template exist in CSV headers
 */
export function validateTemplate(template: string, csvHeaders: string[]): {
    isValid: boolean;
    missingVariables: string[];
} {
    const variables = extractVariables(template);
    const missingVariables = variables.filter(v => !csvHeaders.includes(v));

    return {
        isValid: missingVariables.length === 0,
        missingVariables,
    };
}
