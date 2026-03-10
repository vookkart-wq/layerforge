import { useState, useCallback, useRef } from 'react';
import { Merge, Upload, Check, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useCSVStore } from '@/stores/useCSVStore';
import type { CSVRow } from '@/types';
import { toast } from 'sonner';
import Papa from 'papaparse';

interface MergeCSVDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function MergeCSVDialog({ open, onOpenChange }: MergeCSVDialogProps) {
    const { headers: baseHeaders, data: baseData, mergeCSV } = useCSVStore();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Enriched CSV state
    const [enrichedData, setEnrichedData] = useState<CSVRow[]>([]);
    const [enrichedHeaders, setEnrichedHeaders] = useState<string[]>([]);
    const [enrichedFileName, setEnrichedFileName] = useState('');

    // Selection state
    const [baseIdColumn, setBaseIdColumn] = useState('');
    const [enrichedIdColumn, setEnrichedIdColumn] = useState('');
    const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());

    // Handle file upload
    const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                const data = results.data as CSVRow[];
                const headers = results.meta.fields || [];

                if (data.length === 0 || headers.length === 0) {
                    toast.error('CSV file is empty or invalid');
                    return;
                }

                setEnrichedData(data);
                setEnrichedHeaders(headers);
                setEnrichedFileName(file.name);
                setSelectedColumns(new Set());
                toast.success(`Loaded ${data.length} rows from ${file.name}`);
            },
            error: (error) => {
                toast.error(`Failed to parse CSV: ${error.message}`);
            }
        });

        // Reset input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, []);

    // Get columns that are only in enriched (not in base)
    const newColumnsAvailable = enrichedHeaders.filter(h =>
        h !== enrichedIdColumn && !baseHeaders.includes(h)
    );

    // Get all enriched columns except the ID column
    const columnsToSelect = enrichedHeaders.filter(h => h !== enrichedIdColumn);

    // Toggle column selection
    const toggleColumn = useCallback((col: string) => {
        setSelectedColumns(prev => {
            const next = new Set(prev);
            if (next.has(col)) {
                next.delete(col);
            } else {
                next.add(col);
            }
            return next;
        });
    }, []);

    // Select all / deselect all
    const selectAll = useCallback(() => {
        setSelectedColumns(new Set(columnsToSelect));
    }, [columnsToSelect]);

    const deselectAll = useCallback(() => {
        setSelectedColumns(new Set());
    }, []);

    // Handle merge
    const handleMerge = useCallback(() => {
        if (!baseIdColumn || !enrichedIdColumn) {
            toast.error('Please select identifier columns for both CSVs');
            return;
        }

        if (selectedColumns.size === 0) {
            toast.error('Please select at least one column to merge');
            return;
        }

        mergeCSV(
            enrichedData,
            enrichedHeaders,
            baseIdColumn,
            enrichedIdColumn,
            Array.from(selectedColumns)
        );

        // Count matches
        const enrichedMap = new Map<string, boolean>();
        enrichedData.forEach(row => {
            const key = String(row[enrichedIdColumn] || '').toLowerCase().trim();
            if (key) enrichedMap.set(key, true);
        });

        let matchCount = 0;
        baseData.forEach(row => {
            const key = String(row[baseIdColumn] || '').toLowerCase().trim();
            if (enrichedMap.has(key)) matchCount++;
        });

        toast.success(`Merged ${selectedColumns.size} columns! Matched ${matchCount}/${baseData.length} rows`);

        // Reset and close
        setEnrichedData([]);
        setEnrichedHeaders([]);
        setEnrichedFileName('');
        setBaseIdColumn('');
        setEnrichedIdColumn('');
        setSelectedColumns(new Set());
        onOpenChange(false);
    }, [baseIdColumn, enrichedIdColumn, selectedColumns, enrichedData, enrichedHeaders, baseData, mergeCSV, onOpenChange]);

    // Reset on close
    const handleOpenChange = useCallback((open: boolean) => {
        if (!open) {
            setEnrichedData([]);
            setEnrichedHeaders([]);
            setEnrichedFileName('');
            setBaseIdColumn('');
            setEnrichedIdColumn('');
            setSelectedColumns(new Set());
        }
        onOpenChange(open);
    }, [onOpenChange]);

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Merge className="w-5 h-5" />
                        Merge CSV Data
                    </DialogTitle>
                    <DialogDescription>
                        Import columns from another CSV file by matching on a common identifier column.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-auto space-y-4 py-4">
                    {/* Step 1: Upload enriched CSV */}
                    <div className="space-y-2">
                        <Label className="text-sm font-medium">Step 1: Upload Enriched CSV</Label>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv"
                            onChange={handleFileUpload}
                            className="hidden"
                        />
                        {enrichedFileName ? (
                            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                                <FileSpreadsheet className="w-5 h-5 text-green-600" />
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-green-800">{enrichedFileName}</p>
                                    <p className="text-xs text-green-600">{enrichedData.length} rows, {enrichedHeaders.length} columns</p>
                                </div>
                                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                                    Change
                                </Button>
                            </div>
                        ) : (
                            <Button
                                variant="outline"
                                className="w-full h-20 border-dashed"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <Upload className="w-5 h-5 mr-2" />
                                Click to upload enriched CSV
                            </Button>
                        )}
                    </div>

                    {/* Step 2: Select identifier columns */}
                    {enrichedHeaders.length > 0 && (
                        <div className="space-y-3">
                            <Label className="text-sm font-medium">Step 2: Select Matching Identifier Columns</Label>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label className="text-xs text-muted-foreground">Base CSV Identifier</Label>
                                    <Select value={baseIdColumn} onValueChange={setBaseIdColumn}>
                                        <SelectTrigger className="mt-1">
                                            <SelectValue placeholder="Select column..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {baseHeaders.map(h => (
                                                <SelectItem key={h} value={h}>{h}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label className="text-xs text-muted-foreground">Enriched CSV Identifier</Label>
                                    <Select value={enrichedIdColumn} onValueChange={setEnrichedIdColumn}>
                                        <SelectTrigger className="mt-1">
                                            <SelectValue placeholder="Select column..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {enrichedHeaders.map(h => (
                                                <SelectItem key={h} value={h}>{h}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                These columns should contain matching values (e.g., email, domain, company name)
                            </p>
                        </div>
                    )}

                    {/* Step 3: Select columns to merge */}
                    {baseIdColumn && enrichedIdColumn && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className="text-sm font-medium">Step 3: Select Columns to Import</Label>
                                <div className="flex gap-2">
                                    <Button variant="ghost" size="sm" onClick={selectAll}>Select All</Button>
                                    <Button variant="ghost" size="sm" onClick={deselectAll}>Deselect All</Button>
                                </div>
                            </div>
                            <div className="border rounded-lg max-h-48 overflow-auto">
                                {columnsToSelect.length === 0 ? (
                                    <p className="p-4 text-sm text-muted-foreground text-center">
                                        No additional columns available
                                    </p>
                                ) : (
                                    <div className="divide-y">
                                        {columnsToSelect.map(col => {
                                            const isNew = !baseHeaders.includes(col);
                                            const isSelected = selectedColumns.has(col);
                                            return (
                                                <label
                                                    key={col}
                                                    className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50 ${isSelected ? 'bg-primary/5' : ''}`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggleColumn(col)}
                                                        className="w-4 h-4 rounded border-gray-300"
                                                    />
                                                    <span className="flex-1 text-sm">{col}</span>
                                                    {isNew ? (
                                                        <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">New</span>
                                                    ) : (
                                                        <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded">Exists</span>
                                                    )}
                                                </label>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {selectedColumns.size} column{selectedColumns.size !== 1 ? 's' : ''} selected •
                                Columns marked "Exists" will be renamed (e.g., email → email_1)
                            </p>
                        </div>
                    )}

                    {/* Preview */}
                    {selectedColumns.size > 0 && baseIdColumn && enrichedIdColumn && (
                        <div className="p-3 bg-muted/50 rounded-lg text-sm">
                            <p className="font-medium mb-1">Preview:</p>
                            <p className="text-muted-foreground">
                                Will match <strong>{baseIdColumn}</strong> (base) with <strong>{enrichedIdColumn}</strong> (enriched)
                                and add {selectedColumns.size} column{selectedColumns.size > 1 ? 's' : ''}:
                                <span className="font-mono text-xs ml-1">
                                    {Array.from(selectedColumns).slice(0, 3).join(', ')}
                                    {selectedColumns.size > 3 ? ` +${selectedColumns.size - 3} more` : ''}
                                </span>
                            </p>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleMerge}
                        disabled={!baseIdColumn || !enrichedIdColumn || selectedColumns.size === 0}
                    >
                        <Check className="w-4 h-4 mr-2" />
                        Merge {selectedColumns.size} Column{selectedColumns.size !== 1 ? 's' : ''}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
