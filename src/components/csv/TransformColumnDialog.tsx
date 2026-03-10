import { useState, useCallback, useMemo, useEffect } from 'react';
import { Wand2, Image, SplitSquareVertical, Replace, Columns } from 'lucide-react';
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useCSVStore } from '@/stores/useCSVStore';
import { toast } from 'sonner';
import { parseRowRange } from '@/utils/parseRowRange';

interface TransformColumnDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    displayOrder?: number[];  // Sorted/filtered row indices from display
    initialRowRange?: string; // Pre-fill row range
}

interface TransformOption {
    id: string;
    label: string;
    description: string;
    category: string;
    icon?: React.ReactNode;
    columnLabel?: string; // Custom label for column selector
    createsNewColumn?: boolean; // If true, always creates new column
    newColumnSuffix?: string; // Suffix for auto-generated column name
}

const TRANSFORM_OPTIONS: TransformOption[] = [
    // Special operations
    {
        id: 'logo-url',
        label: 'Generate Logo URL',
        description: 'Create logo URLs from domain/website column (via Clearbit)',
        category: 'Generate',
        icon: <Image className="w-4 h-4 text-blue-500" />,
        columnLabel: 'Source Domain Column',
        createsNewColumn: true,
        newColumnSuffix: 'logo_url'
    },
    {
        id: 'split-lines',
        label: 'Split Lines to Columns',
        description: 'Split multi-line text into separate columns (e.g., field_line_1, field_line_2)',
        category: 'Generate',
        icon: <SplitSquareVertical className="w-4 h-4 text-purple-500" />,
        columnLabel: 'Source Column (with multi-line text)',
        createsNewColumn: true,
        newColumnSuffix: '_line'
    },
    {
        id: 'text-to-columns',
        label: 'Text to Columns',
        description: 'Split text by a delimiter (comma, semicolon, space, etc.) into separate columns',
        category: 'Generate',
        icon: <Columns className="w-4 h-4 text-orange-500" />,
        columnLabel: 'Source Column',
        createsNewColumn: true,
        newColumnSuffix: '_part'
    },
    // URL operations
    { id: 'linkedin-encode', label: 'Encode LinkedIn URLs', description: 'URL-encode special characters in /in/profile or /company/name', category: 'URL' },
    { id: 'extract-domain', label: 'Extract Domain', description: 'Get domain from email or URL (e.g., user@example.com → example.com)', category: 'URL' },
    // Text operations
    {
        id: 'find-replace',
        label: 'Find & Replace',
        description: 'Replace specific text with new text in a column',
        category: 'Text',
        icon: <Replace className="w-4 h-4 text-green-500" />,
    },
    { id: 'uppercase', label: 'UPPERCASE', description: 'Convert all text to uppercase', category: 'Text' },
    { id: 'lowercase', label: 'lowercase', description: 'Convert all text to lowercase', category: 'Text' },
    { id: 'capitalize', label: 'Title Case', description: 'Capitalize first letter of each word', category: 'Text' },
    // Clean operations
    { id: 'trim', label: 'Trim Whitespace', description: 'Remove leading and trailing spaces', category: 'Clean' },
    { id: 'clean-spaces', label: 'Clean Spaces', description: 'Replace multiple spaces with single space', category: 'Clean' },
    { id: 'remove-special', label: 'Remove Special Chars', description: 'Remove all non-alphanumeric characters', category: 'Clean' },
    // Extract operations
    { id: 'extract-numbers', label: 'Extract Numbers', description: 'Keep only numeric digits (e.g., "$1,234" → "1234")', category: 'Extract' },
];

export function TransformColumnDialog({ open, onOpenChange, displayOrder, initialRowRange = '' }: TransformColumnDialogProps) {
    const { headers, data, transformColumn, addLogoColumn } = useCSVStore();

    const [selectedTransform, setSelectedTransform] = useState('');
    const [selectedColumn, setSelectedColumn] = useState('');
    const [createNewColumn, setCreateNewColumn] = useState(false);
    const [newColumnName, setNewColumnName] = useState('');

    // Find & Replace specific state
    const [findText, setFindText] = useState('');
    const [replaceText, setReplaceText] = useState('');
    const [caseSensitive, setCaseSensitive] = useState(false);

    // Text to Columns specific state
    const [delimiter, setDelimiter] = useState(',');
    const [customDelimiter, setCustomDelimiter] = useState('');

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

    // Get the selected transform option
    const selectedOption = useMemo(() =>
        TRANSFORM_OPTIONS.find(t => t.id === selectedTransform),
        [selectedTransform]
    );

    // Auto-generate new column name when transform or column changes
    const suggestedColumnName = useMemo(() => {
        if (!selectedColumn || !selectedTransform) return '';
        const option = TRANSFORM_OPTIONS.find(t => t.id === selectedTransform);
        if (option?.newColumnSuffix) {
            return option.newColumnSuffix;
        }
        const transformLabel = option?.label || selectedTransform;
        return `${selectedColumn}_${transformLabel.toLowerCase().replace(/\s+/g, '_')}`;
    }, [selectedColumn, selectedTransform]);

    // Determine if new column should be created
    const willCreateNewColumn = selectedOption?.createsNewColumn || createNewColumn;

    // Build the find-replace transform function based on current inputs
    const findReplaceTransform = useCallback((v: string) => {
        if (!findText) return v;
        if (caseSensitive) {
            return v.split(findText).join(replaceText);
        } else {
            const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return v.replace(new RegExp(escaped, 'gi'), replaceText);
        }
    }, [findText, replaceText, caseSensitive]);

    // Get preview of transformation
    const preview = useMemo(() => {
        if (!selectedColumn || !selectedTransform || data.length === 0) return null;

        // For find-replace, only show preview if find text is entered
        if (selectedTransform === 'find-replace' && !findText) return null;

        const sampleValues = data.slice(0, 3).map(row => row[selectedColumn] || '').filter(Boolean);
        if (sampleValues.length === 0) return null;

        // For find-replace, only show rows that actually contain the find text
        if (selectedTransform === 'find-replace') {
            const matchingValues = data
                .map(row => row[selectedColumn] || '')
                .filter(v => caseSensitive ? v.includes(findText) : v.toLowerCase().includes(findText.toLowerCase()))
                .slice(0, 3);
            if (matchingValues.length === 0) return [{ before: '(no matches found)', after: '' }];
            return matchingValues.map(v => ({ before: v, after: findReplaceTransform(v) }));
        }

        // Special preview for text-to-columns
        if (selectedTransform === 'text-to-columns') {
            const actualDelimiter = delimiter === 'custom' ? customDelimiter : delimiter;
            if (!actualDelimiter) return [{ before: '(enter a delimiter)', after: '' }];
            const sample = sampleValues[0];
            const parts = sample.split(actualDelimiter).map(p => p.trim());
            if (parts.length <= 1) return [{ before: sample, after: '(no delimiter found in sample)' }];
            return parts.map((part, i) => ({
                before: `${selectedColumn}_${i + 1}`,
                after: part
            }));
        }

        // Special preview for split-lines
        if (selectedTransform === 'split-lines') {
            const sample = sampleValues[0];
            const lines = sample.split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length <= 1) {
                return [{ before: sample, after: '(no line breaks found)' }];
            }
            return lines.map((line, i) => ({
                before: `${selectedColumn}_line_${i + 1}`,
                after: line
            }));
        }

        // Transform functions
        const transforms: Record<string, (value: string) => string> = {
            'logo-url': (v) => {
                const domain = v.includes('@')
                    ? v.split('@').pop() || ''
                    : v.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
                return `https://logo.clearbit.com/${domain}`;
            },
            'linkedin-encode': (v) => {
                // Handle both /in/ (profiles) and /company/ URLs
                // Note: encodeURIComponent doesn't encode apostrophes, so we do it manually
                if (v.includes('/in/')) {
                    const [base, rest] = v.split('/in/');
                    const slug = (rest || '').split('/')[0].split('?')[0];
                    return base + '/in/' + encodeURIComponent(slug).replace(/'/g, '%27');
                }
                if (v.includes('/company/')) {
                    const [base, rest] = v.split('/company/');
                    const slug = (rest || '').split('/')[0].split('?')[0];
                    return base + '/company/' + encodeURIComponent(slug).replace(/'/g, '%27');
                }
                return v;
            },
            'extract-domain': (v) => v.includes('@') ? v.split('@').pop() || '' : v.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0],
            'uppercase': (v) => v.toUpperCase(),
            'lowercase': (v) => v.toLowerCase(),
            'capitalize': (v) => v.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '),
            'trim': (v) => v.trim(),
            'clean-spaces': (v) => v.replace(/\s+/g, ' ').trim(),
            'extract-numbers': (v) => v.replace(/\D/g, ''),
            'remove-special': (v) => v.replace(/[^a-zA-Z0-9\s]/g, ''),
        };

        const fn = transforms[selectedTransform];
        if (!fn) return null;

        return sampleValues.map(v => ({ before: v, after: fn(v) }));
    }, [selectedColumn, selectedTransform, data, findText, replaceText, caseSensitive, findReplaceTransform, delimiter, customDelimiter]);

    // Handle transform
    const handleTransform = useCallback(() => {
        if (!selectedColumn || !selectedTransform) {
            toast.error('Please select a transformation and column');
            return;
        }

        // Validate find-replace has find text
        if (selectedTransform === 'find-replace' && !findText) {
            toast.error('Please enter the text to find');
            return;
        }

        const option = TRANSFORM_OPTIONS.find(t => t.id === selectedTransform);
        const transformLabel = option?.label || selectedTransform;

        // Get row indices to process
        const allIndices = displayOrder || Array.from({ length: data.length }, (_, i) => i);

        let rowIndices = allIndices;
        if (rowRange.trim()) {
            const displayPositions = parseRowRange(rowRange, allIndices.length);
            if (displayPositions.length === 0) {
                toast.error('Invalid row range format. Use: 1-5, 10, 15-20');
                return;
            }
            rowIndices = displayPositions.map(pos => allIndices[pos]).filter(idx => idx !== undefined);
        } else if (rowCount > 0) {
            rowIndices = allIndices.slice(0, Math.min(rowCount, allIndices.length));
        }

        // Special handling for text-to-columns
        if (selectedTransform === 'text-to-columns') {
            const { addColumn, updateCell } = useCSVStore.getState();
            const actualDelimiter = delimiter === 'custom' ? customDelimiter : delimiter;
            if (!actualDelimiter) {
                toast.error('Please enter a delimiter');
                return;
            }

            // Find max number of parts across all rows
            let maxParts = 0;
            rowIndices.forEach(idx => {
                const row = data[idx];
                if (row) {
                    const text = row[selectedColumn] || '';
                    const parts = text.split(actualDelimiter).map(p => p.trim());
                    maxParts = Math.max(maxParts, parts.length);
                }
            });

            if (maxParts <= 1) {
                toast.error(`No "${actualDelimiter}" delimiter found in selected column`);
                return;
            }

            // Create columns for each part
            const baseColName = newColumnName.trim() || selectedColumn;
            for (let i = 1; i <= maxParts; i++) {
                const colName = `${baseColName}_${i}`;
                if (!headers.includes(colName)) {
                    addColumn(colName, '');
                }
            }

            // Populate the columns
            rowIndices.forEach(idx => {
                const row = data[idx];
                if (row) {
                    const text = row[selectedColumn] || '';
                    const parts = text.split(actualDelimiter).map(p => p.trim());
                    for (let i = 1; i <= maxParts; i++) {
                        const colName = `${baseColName}_${i}`;
                        updateCell(idx, colName, parts[i - 1] || '');
                    }
                }
            });

            toast.success(`Split into ${maxParts} columns from "${selectedColumn}" (${rowIndices.length} rows)`);
        }
        // Special handling for split-lines - creates multiple columns
        else if (selectedTransform === 'split-lines') {
            const { addColumn, updateCell } = useCSVStore.getState();

            // Find max number of lines across all rows
            let maxLines = 0;
            rowIndices.forEach(idx => {
                const row = data[idx];
                if (row) {
                    const text = row[selectedColumn] || '';
                    const lines = text.split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l.length > 0);
                    maxLines = Math.max(maxLines, lines.length);
                }
            });

            if (maxLines <= 1) {
                toast.error('No multi-line content found in selected column');
                return;
            }

            // Create columns for each line
            const baseColName = newColumnName.trim() || selectedColumn;
            for (let i = 1; i <= maxLines; i++) {
                const colName = `${baseColName}_line_${i}`;
                if (!headers.includes(colName)) {
                    addColumn(colName, '');
                }
            }

            // Populate the columns
            rowIndices.forEach(idx => {
                const row = data[idx];
                if (row) {
                    const text = row[selectedColumn] || '';
                    const lines = text.split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l.length > 0);
                    for (let i = 1; i <= maxLines; i++) {
                        const colName = `${baseColName}_line_${i}`;
                        updateCell(idx, colName, lines[i - 1] || '');
                    }
                }
            });

            toast.success(`Created ${maxLines} columns from "${selectedColumn}" (${rowIndices.length} rows)`);
        }
        // Special handling for logo-url
        else if (selectedTransform === 'logo-url') {
            const columnName = newColumnName.trim() || 'logo_url';
            // Use addLogoColumn which processes all rows, or handle manually for specific rows
            if (rowIndices.length === allIndices.length) {
                addLogoColumn(selectedColumn, columnName);
            } else {
                // Manual handling for specific rows - need updateCell
                const { addColumn, updateCell } = useCSVStore.getState();
                if (!data[0]?.[columnName]) {
                    addColumn(columnName, '');
                }
                rowIndices.forEach(idx => {
                    const row = data[idx];
                    if (row) {
                        const domain = (row[selectedColumn] || '').includes('@')
                            ? (row[selectedColumn] || '').split('@').pop() || ''
                            : (row[selectedColumn] || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
                        updateCell(idx, columnName, `https://logo.clearbit.com/${domain}`);
                    }
                });
            }
            toast.success(`Created "${columnName}" column with logo URLs for ${rowIndices.length} rows`);
        }
        // Special handling for find-replace - always do locally since store doesn't have find/replace text
        else if (selectedTransform === 'find-replace') {
            const { updateCells: batchUpdateCells } = useCSVStore.getState();
            const updates: { rowIndex: number; header: string; value: string }[] = [];
            let replacedCount = 0;

            rowIndices.forEach(idx => {
                const row = data[idx];
                if (row) {
                    const original = row[selectedColumn] || '';
                    const transformed = findReplaceTransform(original);
                    if (transformed !== original) {
                        updates.push({ rowIndex: idx, header: selectedColumn, value: transformed });
                        replacedCount++;
                    }
                }
            });

            if (updates.length > 0) {
                batchUpdateCells(updates);
                toast.success(`Replaced in ${replacedCount} rows in "${selectedColumn}"`);
            } else {
                toast.info('No matches found to replace');
            }
        } else if (willCreateNewColumn) {
            if (!newColumnName.trim()) {
                toast.error('Please enter a name for the new column');
                return;
            }
            // Use transformColumn for all rows, or manual for specific
            if (rowIndices.length === allIndices.length) {
                transformColumn(selectedColumn, selectedTransform, newColumnName.trim());
            } else {
                const { addColumn, updateCell } = useCSVStore.getState();
                const colName = newColumnName.trim();
                if (!data[0]?.[colName]) {
                    addColumn(colName, '');
                }
                // Apply transform manually to specific rows
                const transforms: Record<string, (value: string) => string> = {
                    'find-replace': findReplaceTransform,
                    'linkedin-encode': (v) => {
                        if (v.includes('/in/')) {
                            const [base, rest] = v.split('/in/');
                            const slug = (rest || '').split('/')[0].split('?')[0];
                            return base + '/in/' + encodeURIComponent(slug).replace(/'/g, '%27');
                        }
                        if (v.includes('/company/')) {
                            const [base, rest] = v.split('/company/');
                            const slug = (rest || '').split('/')[0].split('?')[0];
                            return base + '/company/' + encodeURIComponent(slug).replace(/'/g, '%27');
                        }
                        return v;
                    },
                    'extract-domain': (v) => v.includes('@') ? v.split('@').pop() || '' : v.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0],
                    'uppercase': (v) => v.toUpperCase(),
                    'lowercase': (v) => v.toLowerCase(),
                    'capitalize': (v) => v.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '),
                    'trim': (v) => v.trim(),
                    'clean-spaces': (v) => v.replace(/\s+/g, ' ').trim(),
                    'extract-numbers': (v) => v.replace(/\D/g, ''),
                    'remove-special': (v) => v.replace(/[^a-zA-Z0-9\s]/g, ''),
                };
                const fn = transforms[selectedTransform];
                if (fn) {
                    rowIndices.forEach(idx => {
                        const row = data[idx];
                        if (row) {
                            updateCell(idx, colName, fn(row[selectedColumn] || ''));
                        }
                    });
                }
            }
            toast.success(`Created "${newColumnName.trim()}" with "${transformLabel}" for ${rowIndices.length} rows`);
        } else {
            // In-place transform
            if (rowIndices.length === allIndices.length) {
                transformColumn(selectedColumn, selectedTransform);
            } else {
                const { updateCell } = useCSVStore.getState();
                const transforms: Record<string, (value: string) => string> = {
                    'find-replace': findReplaceTransform,
                    'linkedin-encode': (v) => {
                        if (v.includes('/in/')) {
                            const [base, rest] = v.split('/in/');
                            const slug = (rest || '').split('/')[0].split('?')[0];
                            return base + '/in/' + encodeURIComponent(slug).replace(/'/g, '%27');
                        }
                        if (v.includes('/company/')) {
                            const [base, rest] = v.split('/company/');
                            const slug = (rest || '').split('/')[0].split('?')[0];
                            return base + '/company/' + encodeURIComponent(slug).replace(/'/g, '%27');
                        }
                        return v;
                    },
                    'extract-domain': (v) => v.includes('@') ? v.split('@').pop() || '' : v.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0],
                    'uppercase': (v) => v.toUpperCase(),
                    'lowercase': (v) => v.toLowerCase(),
                    'capitalize': (v) => v.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '),
                    'trim': (v) => v.trim(),
                    'clean-spaces': (v) => v.replace(/\s+/g, ' ').trim(),
                    'extract-numbers': (v) => v.replace(/\D/g, ''),
                    'remove-special': (v) => v.replace(/[^a-zA-Z0-9\s]/g, ''),
                };
                const fn = transforms[selectedTransform];
                if (fn) {
                    rowIndices.forEach(idx => {
                        const row = data[idx];
                        if (row) {
                            updateCell(idx, selectedColumn, fn(row[selectedColumn] || ''));
                        }
                    });
                }
            }
            toast.success(`Applied "${transformLabel}" to ${rowIndices.length} rows in "${selectedColumn}"`);
        }

        // Reset and close
        setSelectedTransform('');
        setSelectedColumn('');
        setCreateNewColumn(false);
        setNewColumnName('');
        setFindText('');
        setReplaceText('');
        setDelimiter(',');
        setCustomDelimiter('');
        setRowCount(0);
        setRowRange('');
        onOpenChange(false);
    }, [selectedColumn, selectedTransform, willCreateNewColumn, newColumnName, transformColumn, addLogoColumn, onOpenChange, displayOrder, rowCount, rowRange, data, findText, findReplaceTransform]);

    // Reset on close
    const handleOpenChange = useCallback((open: boolean) => {
        if (!open) {
            setSelectedTransform('');
            setSelectedColumn('');
            setCreateNewColumn(false);
            setNewColumnName('');
            setFindText('');
            setReplaceText('');
            setDelimiter(',');
            setCustomDelimiter('');
        }
        onOpenChange(open);
    }, [onOpenChange]);

    // Group transforms by category - put "Generate" first
    const groupedTransforms = useMemo(() => {
        const groups: Record<string, TransformOption[]> = {};
        const categoryOrder = ['Generate', 'URL', 'Text', 'Clean', 'Extract'];

        TRANSFORM_OPTIONS.forEach(t => {
            if (!groups[t.category]) groups[t.category] = [];
            groups[t.category].push(t);
        });

        // Return in preferred order
        const ordered: [string, TransformOption[]][] = [];
        categoryOrder.forEach(cat => {
            if (groups[cat]) ordered.push([cat, groups[cat]]);
        });
        return ordered;
    }, []);

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Wand2 className="w-5 h-5" />
                        Transform Column
                    </DialogTitle>
                    <DialogDescription>
                        Choose an operation, then select which column to apply it to.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-auto space-y-4 py-4">
                    {/* Step 1: Transform selection - ALWAYS VISIBLE */}
                    <div>
                        <Label className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">1</span>
                            Choose Operation
                        </Label>
                        <div className="mt-2 border rounded-lg divide-y overflow-auto">
                            {groupedTransforms.map(([category, transforms]) => (
                                <div key={category}>
                                    <div className="px-3 py-1.5 bg-muted/50 text-xs font-medium text-muted-foreground sticky top-0">
                                        {category}
                                    </div>
                                    {transforms.map(t => (
                                        <label
                                            key={t.id}
                                            className={`flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50 ${selectedTransform === t.id ? 'bg-primary/10 border-l-2 border-l-primary' : ''}`}
                                        >
                                            <input
                                                type="radio"
                                                name="transform"
                                                checked={selectedTransform === t.id}
                                                onChange={() => {
                                                    setSelectedTransform(t.id);
                                                    // Auto-set new column name for special operations
                                                    if (t.createsNewColumn && t.newColumnSuffix) {
                                                        setNewColumnName(t.newColumnSuffix);
                                                    }
                                                }}
                                                className="mt-0.5"
                                            />
                                            <div className="flex-1">
                                                <p className="text-sm font-medium flex items-center gap-2">
                                                    {t.icon}
                                                    {t.label}
                                                </p>
                                                <p className="text-xs text-muted-foreground">{t.description}</p>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Step 2: Column selection - SHOWN AFTER TRANSFORM SELECTED */}
                    {selectedTransform && (
                        <div>
                            <Label className="flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">2</span>
                                {selectedOption?.columnLabel || 'Select Column'}
                            </Label>
                            <Select value={selectedColumn} onValueChange={setSelectedColumn}>
                                <SelectTrigger className="mt-1">
                                    <SelectValue placeholder="Choose a column..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {headers.map(h => (
                                        <SelectItem key={h} value={h}>{h}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {/* Text to Columns delimiter picker - SHOWN WHEN text-to-columns IS SELECTED */}
                    {selectedColumn && selectedTransform === 'text-to-columns' && (
                        <div className="space-y-3 p-3 bg-orange-500/5 border border-orange-500/20 rounded-lg">
                            <div>
                                <Label className="text-sm flex items-center gap-2">
                                    <span className="w-5 h-5 rounded-full bg-orange-600 text-white text-xs flex items-center justify-center">3</span>
                                    Choose Delimiter
                                </Label>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {[{ value: ',', label: 'Comma (,)' }, { value: ';', label: 'Semicolon (;)' }, { value: '|', label: 'Pipe (|)' }, { value: ' ', label: 'Space' }, { value: '\t', label: 'Tab' }, { value: 'custom', label: 'Custom' }].map(d => (
                                    <button
                                        key={d.value}
                                        onClick={() => setDelimiter(d.value)}
                                        className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${delimiter === d.value
                                            ? 'bg-orange-500 text-white border-orange-500'
                                            : 'bg-background hover:bg-muted border-border'
                                            }`}
                                    >
                                        {d.label}
                                    </button>
                                ))}
                            </div>
                            {delimiter === 'custom' && (
                                <Input
                                    value={customDelimiter}
                                    onChange={(e) => setCustomDelimiter(e.target.value)}
                                    placeholder="Enter delimiter..."
                                    className="h-8"
                                    autoFocus
                                />
                            )}
                            <div>
                                <Label className="text-xs text-muted-foreground">Column name prefix</Label>
                                <Input
                                    value={newColumnName}
                                    onChange={(e) => setNewColumnName(e.target.value)}
                                    placeholder={selectedColumn}
                                    className="mt-1 h-8"
                                />
                            </div>
                        </div>
                    )}

                    {/* Find & Replace inputs - SHOWN WHEN find-replace IS SELECTED */}
                    {selectedColumn && selectedTransform === 'find-replace' && (
                        <div className="space-y-3 p-3 bg-green-500/5 border border-green-500/20 rounded-lg">
                            <div>
                                <Label className="text-sm flex items-center gap-2">
                                    <span className="w-5 h-5 rounded-full bg-green-600 text-white text-xs flex items-center justify-center">3</span>
                                    Find & Replace
                                </Label>
                            </div>
                            <div className="space-y-2">
                                <div>
                                    <Label className="text-xs text-muted-foreground">Find</Label>
                                    <Input
                                        value={findText}
                                        onChange={(e) => setFindText(e.target.value)}
                                        placeholder="Text to find..."
                                        className="mt-1 h-8"
                                        autoFocus
                                    />
                                </div>
                                <div>
                                    <Label className="text-xs text-muted-foreground">Replace with</Label>
                                    <Input
                                        value={replaceText}
                                        onChange={(e) => setReplaceText(e.target.value)}
                                        placeholder="Replacement text (leave empty to delete)"
                                        className="mt-1 h-8"
                                    />
                                </div>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={caseSensitive}
                                        onChange={(e) => setCaseSensitive(e.target.checked)}
                                        className="w-4 h-4 rounded"
                                    />
                                    <span className="text-xs">Case sensitive</span>
                                </label>
                                {findText && (
                                    <p className="text-xs text-muted-foreground">
                                        {(() => {
                                            const count = data.filter(row => {
                                                const val = row[selectedColumn] || '';
                                                return caseSensitive ? val.includes(findText) : val.toLowerCase().includes(findText.toLowerCase());
                                            }).length;
                                            return `${count} of ${data.length} rows contain "${findText}"`;
                                        })()}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Step 3: Output options - SHOWN AFTER COLUMN SELECTED (not for find-replace or text-to-columns) */}
                    {selectedColumn && selectedTransform && selectedTransform !== 'find-replace' && selectedTransform !== 'text-to-columns' && (
                        <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
                            {selectedOption?.createsNewColumn ? (
                                // For operations that always create new columns (like Logo URL)
                                <div>
                                    <Label className="text-sm">New column name</Label>
                                    <Input
                                        value={newColumnName}
                                        onChange={(e) => setNewColumnName(e.target.value)}
                                        placeholder={suggestedColumnName}
                                        className="mt-1 h-8"
                                    />
                                </div>
                            ) : (
                                // For operations that can modify in-place or create new
                                <>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={createNewColumn}
                                            onChange={(e) => {
                                                setCreateNewColumn(e.target.checked);
                                                if (e.target.checked && !newColumnName) {
                                                    setNewColumnName(suggestedColumnName);
                                                }
                                            }}
                                            className="w-4 h-4 rounded"
                                        />
                                        <span className="text-sm font-medium">Create new column (keep original)</span>
                                    </label>

                                    {createNewColumn && (
                                        <div className="pl-6">
                                            <Label className="text-xs text-muted-foreground">New column name</Label>
                                            <Input
                                                value={newColumnName}
                                                onChange={(e) => setNewColumnName(e.target.value)}
                                                placeholder={suggestedColumnName}
                                                className="mt-1 h-8"
                                            />
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* Row selection - shown after column selected */}
                    {selectedColumn && selectedTransform && (
                        <div className="space-y-3 p-3 bg-muted/20 rounded-lg border">
                            <div>
                                <Label className="text-sm">Rows to Process</Label>
                                <div className="flex items-center gap-2 mt-1">
                                    <Input
                                        type="number"
                                        min={0}
                                        max={data.length}
                                        value={rowCount || ''}
                                        onChange={(e) => setRowCount(Math.min(Number(e.target.value) || 0, data.length))}
                                        placeholder="All"
                                        className="w-24 h-8"
                                        disabled={!!rowRange.trim()}
                                    />
                                    <span className="text-xs text-muted-foreground">
                                        of {data.length} rows
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setRowCount(data.length)}
                                        disabled={!!rowRange.trim()}
                                        className="h-7 text-xs"
                                    >
                                        All
                                    </Button>
                                </div>
                            </div>
                            <div>
                                <Label className="text-xs text-muted-foreground">Or Specify Rows</Label>
                                <Input
                                    placeholder="e.g., 1-5, 10, 15-20"
                                    value={rowRange}
                                    onChange={(e) => setRowRange(e.target.value)}
                                    className="mt-1 h-8"
                                />
                            </div>
                        </div>
                    )}

                    {/* Preview */}
                    {preview && preview.length > 0 && (
                        <div className="p-3 bg-muted/50 rounded-lg">
                            <p className="text-xs font-medium mb-2">Preview (first {preview.length} rows):</p>
                            <div className="space-y-1.5">
                                {preview.map((p, idx) => (
                                    <div key={idx} className="text-xs font-mono flex items-center gap-2">
                                        <span className="text-muted-foreground truncate max-w-[180px]" title={p.before}>
                                            {p.before}
                                        </span>
                                        <span className="text-muted-foreground">→</span>
                                        <span className="text-green-600 truncate max-w-[180px]" title={p.after}>
                                            {p.after || '(empty)'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleTransform}
                        disabled={!selectedColumn || !selectedTransform || (willCreateNewColumn && !newColumnName.trim()) || (selectedTransform === 'find-replace' && !findText)}
                    >
                        <Wand2 className="w-4 h-4 mr-2" />
                        {selectedOption?.createsNewColumn
                            ? `Generate Column${rowRange.trim() || rowCount > 0 ? ` (${rowRange.trim() ? 'selected' : rowCount} rows)` : ''}`
                            : willCreateNewColumn
                                ? `Create Column${rowRange.trim() || rowCount > 0 ? ` (${rowRange.trim() ? 'selected' : rowCount} rows)` : ''}`
                                : `Apply Transform${rowRange.trim() || rowCount > 0 ? ` (${rowRange.trim() ? 'selected' : rowCount} rows)` : ''}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
