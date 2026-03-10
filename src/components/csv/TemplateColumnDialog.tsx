import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { FileText, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useCSVStore } from '@/stores/useCSVStore';
import { toast } from 'sonner';
import { parseRowRange } from '@/utils/parseRowRange';

interface TemplateColumnDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    displayOrder?: number[];  // Sorted/filtered row indices from display
    initialRowRange?: string; // Pre-fill row range
}

// Extract column references like {column_name} from template
function extractColumnReferences(template: string): string[] {
    const regex = /\{([^}]+)\}/g;
    const matches: string[] = [];
    let match;
    while ((match = regex.exec(template)) !== null) {
        if (!matches.includes(match[1])) {
            matches.push(match[1]);
        }
    }
    return matches;
}

// Validate that all referenced columns exist
function validateTemplateColumns(template: string, headers: string[]): string[] {
    const refs = extractColumnReferences(template);
    return refs.filter(ref => !headers.includes(ref));
}

// Apply template to a row
function applyTemplate(template: string, row: Record<string, string>): string {
    return template.replace(/\{([^}]+)\}/g, (match, columnName) => {
        return row[columnName] ?? '';
    });
}

// Common template presets
const TEMPLATE_PRESETS = [
    {
        name: 'HTML Image Tag',
        template: '<img src="{image_url}" alt="image" style="max-width:100%; height:auto;">',
        description: 'Wraps URL in an img tag'
    },
    {
        name: 'HTML Link',
        template: '<a href="{url}" target="_blank">{text}</a>',
        description: 'Creates a clickable link'
    },
    {
        name: 'Full Name',
        template: '{first_name} {last_name}',
        description: 'Combines first and last name'
    },
    {
        name: 'Email Signature',
        template: '{name} | {title} at {company}',
        description: 'Creates a signature line'
    },
    {
        name: 'Markdown Image',
        template: '![{alt_text}]({image_url})',
        description: 'Markdown image syntax'
    },
    {
        name: 'CSV Cell',
        template: '"{value}"',
        description: 'Wraps value in quotes'
    }
];

export function TemplateColumnDialog({ open, onOpenChange, displayOrder, initialRowRange = '' }: TemplateColumnDialogProps) {
    const { headers, data, addColumn, updateCell } = useCSVStore();

    const [columnName, setColumnName] = useState('new_column');
    const [template, setTemplate] = useState('');
    const [cursorPos, setCursorPos] = useState(0);
    const templateRef = useRef<HTMLTextAreaElement>(null);

    // Row selection state
    const [rowCount, setRowCount] = useState(0); // 0 means all
    const [rowRange, setRowRange] = useState(initialRowRange);

    // Sync rowRange when initialRowRange changes or dialog opens
    useEffect(() => {
        if (open) {
            if (initialRowRange) {
                setRowRange(initialRowRange);
            }
            setRowCount(0); // Default to all rows
        }
    }, [open, initialRowRange]);

    // Column references in template
    const columnRefs = useMemo(() => extractColumnReferences(template), [template]);
    const invalidColumns = useMemo(() => validateTemplateColumns(template, headers), [template, headers]);

    // Preview using first row
    const preview = useMemo(() => {
        if (!template || data.length === 0) return '';
        try {
            return applyTemplate(template, data[0]);
        } catch {
            return '(error)';
        }
    }, [template, data]);

    // Insert column reference at cursor position
    const insertColumn = useCallback((col: string) => {
        const insertion = `{${col}}`;
        setTemplate(prev => {
            const before = prev.slice(0, cursorPos);
            const after = prev.slice(cursorPos);
            return before + insertion + after;
        });
        setCursorPos(prev => prev + insertion.length);
        setTimeout(() => templateRef.current?.focus(), 0);
    }, [cursorPos]);

    // Apply template preset
    const applyPreset = useCallback((preset: typeof TEMPLATE_PRESETS[0]) => {
        setTemplate(preset.template);
    }, []);

    // Create the column
    const handleCreate = useCallback(() => {
        if (!columnName.trim()) {
            toast.error('Please enter a column name');
            return;
        }

        if (!template.trim()) {
            toast.error('Please enter a template');
            return;
        }

        if (invalidColumns.length > 0) {
            toast.error(`Unknown columns: ${invalidColumns.join(', ')}`);
            return;
        }

        // Check if column already exists
        const finalName = columnName.trim();
        if (headers.includes(finalName)) {
            toast.error(`Column "${finalName}" already exists`);
            return;
        }

        // Create the column
        addColumn(finalName, '');

        // Get row indices to process - use display order if available
        const allIndices = displayOrder || Array.from({ length: data.length }, (_, i) => i);

        // Apply row range filter if specified
        let rowIndices = allIndices;
        if (rowRange.trim()) {
            const displayPositions = parseRowRange(rowRange, allIndices.length);
            if (displayPositions.length === 0) {
                toast.error('Invalid row range format. Use: 1-5, 10, 15-20');
                return;
            }
            rowIndices = displayPositions.map(pos => allIndices[pos]).filter(idx => idx !== undefined);
        } else if (rowCount > 0) {
            // Use row count if specified
            rowIndices = allIndices.slice(0, Math.min(rowCount, allIndices.length));
        }

        // Apply template to selected rows
        rowIndices.forEach(idx => {
            const row = data[idx];
            if (row) {
                const result = applyTemplate(template, row);
                updateCell(idx, finalName, result);
            }
        });

        toast.success(`Created "${finalName}" with ${rowIndices.length} values`);
        onOpenChange(false);

        // Reset state
        setColumnName('new_column');
        setTemplate('');
        setRowCount(0);
        setRowRange('');
    }, [columnName, template, invalidColumns, headers, data, addColumn, updateCell, onOpenChange, displayOrder, rowCount, rowRange]);

    // Reset on close
    const handleOpenChange = useCallback((open: boolean) => {
        if (!open) {
            setColumnName('new_column');
            setTemplate('');
        }
        onOpenChange(open);
    }, [onOpenChange]);

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileText className="w-5 h-5" />
                        Template Column
                    </DialogTitle>
                    <DialogDescription>
                        Create a new column using a template. Use {'{column_name}'} to insert values from other columns.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-auto space-y-4 py-4">
                    {/* Column name */}
                    <div>
                        <Label>New Column Name</Label>
                        <Input
                            value={columnName}
                            onChange={(e) => setColumnName(e.target.value)}
                            placeholder="new_column"
                            className="mt-1"
                        />
                    </div>

                    {/* Template presets */}
                    <div>
                        <Label className="text-xs text-muted-foreground">Quick Templates</Label>
                        <div className="flex flex-wrap gap-1 mt-1">
                            {TEMPLATE_PRESETS.map(preset => (
                                <Button
                                    key={preset.name}
                                    variant="outline"
                                    size="sm"
                                    className="text-xs h-7"
                                    onClick={() => applyPreset(preset)}
                                    title={preset.description}
                                >
                                    {preset.name}
                                </Button>
                            ))}
                        </div>
                    </div>

                    {/* Column insertion buttons */}
                    <div>
                        <Label className="text-xs text-muted-foreground">Insert Column</Label>
                        <div className="flex flex-wrap gap-1 mt-1">
                            {headers.map(h => (
                                <Button
                                    key={h}
                                    variant="secondary"
                                    size="sm"
                                    className="text-xs h-6 px-2"
                                    onClick={() => insertColumn(h)}
                                >
                                    {'{' + h + '}'}
                                </Button>
                            ))}
                        </div>
                    </div>

                    {/* Template textarea */}
                    <div>
                        <Label>Template</Label>
                        <textarea
                            ref={templateRef}
                            value={template}
                            onChange={(e) => {
                                setTemplate(e.target.value);
                                setCursorPos(e.target.selectionStart);
                            }}
                            onSelect={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart)}
                            onClick={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart)}
                            onKeyUp={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart)}
                            placeholder='<img src="{image_url}" alt="image for {name}">'
                            className="mt-1 w-full h-24 px-3 py-2 text-sm font-mono border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary bg-background"
                        />
                        {invalidColumns.length > 0 && (
                            <div className="flex items-center gap-1 mt-1 text-xs text-destructive">
                                <AlertCircle className="w-3 h-3" />
                                Unknown columns: {invalidColumns.join(', ')}
                            </div>
                        )}
                        {columnRefs.length > 0 && invalidColumns.length === 0 && (
                            <div className="text-xs text-muted-foreground mt-1">
                                Using columns: {columnRefs.join(', ')}
                            </div>
                        )}
                    </div>

                    {/* Preview */}
                    {template && data.length > 0 && invalidColumns.length === 0 && (
                        <div>
                            <Label className="text-xs text-muted-foreground">Preview (Row 1)</Label>
                            <div className="mt-1 p-2 bg-muted rounded-md text-xs font-mono break-all max-h-20 overflow-auto">
                                {preview}
                            </div>
                        </div>
                    )}

                    {/* Row selection */}
                    <div>
                        <Label>Rows to Process</Label>
                        <div className="flex items-center gap-2 mt-1">
                            <Input
                                type="number"
                                min={0}
                                max={data.length}
                                value={rowCount || ''}
                                onChange={(e) => setRowCount(Math.min(Number(e.target.value) || 0, data.length))}
                                placeholder="All"
                                className="w-24"
                                disabled={!!rowRange.trim()}
                            />
                            <span className="text-sm text-muted-foreground">
                                of {data.length} total rows
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setRowCount(data.length)}
                                disabled={!!rowRange.trim()}
                            >
                                All
                            </Button>
                        </div>
                    </div>

                    {/* Specific row range */}
                    <div>
                        <Label>Or Specify Rows (Optional)</Label>
                        <Input
                            placeholder="e.g., 1-5, 10, 15-20"
                            value={rowRange}
                            onChange={(e) => setRowRange(e.target.value)}
                            className="mt-1"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                            Process specific rows. Leave empty to use row count above.
                        </p>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleCreate}
                        disabled={!template.trim() || !columnName.trim() || invalidColumns.length > 0}
                    >
                        <FileText className="w-4 h-4 mr-2" />
                        Create Column ({rowRange.trim() ? 'specified rows' : rowCount > 0 ? `${rowCount} rows` : `${data.length} rows`})
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
