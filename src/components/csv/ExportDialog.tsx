import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Download, FileJson, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useCSVStore } from '@/stores/useCSVStore';
import { ENRICHED_COLUMN_PREFIX } from '@/services/apifyService';

interface ExportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

// Helper to detect if a cell value looks like JSON
function isJsonValue(value: string): boolean {
    if (!value) return false;
    const trimmed = value.trim();
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'));
}

// Helper to get estimated size of column data
function getColumnDataSize(data: Record<string, string>[], header: string): number {
    let size = 0;
    for (const row of data) {
        size += (row[header] || '').length;
    }
    return size;
}

export function ExportDialog({ open, onOpenChange }: ExportDialogProps) {
    const { headers, data } = useCSVStore();

    // Analyze columns to find JSON/enrichment columns
    const columnAnalysis = useMemo(() => {
        return headers.map(header => {
            const isEnrichment = header.startsWith(ENRICHED_COLUMN_PREFIX);

            // Check if column contains JSON data (sample first 5 rows)
            let hasJsonData = false;
            for (let i = 0; i < Math.min(5, data.length); i++) {
                if (isJsonValue(data[i]?.[header] || '')) {
                    hasJsonData = true;
                    break;
                }
            }

            const dataSize = getColumnDataSize(data, header);
            const isLargeJson = hasJsonData && dataSize > 10000; // > 10KB

            return {
                header,
                isEnrichment,
                hasJsonData,
                dataSize,
                isLargeJson,
                // Auto-exclude enrichment and large JSON columns
                defaultSelected: !isEnrichment && !isLargeJson
            };
        });
    }, [headers, data]);

    // Initialize selected columns with defaults
    const [selectedColumns, setSelectedColumns] = useState<Set<string>>(() => {
        const defaults = new Set<string>();
        columnAnalysis.forEach(col => {
            if (col.defaultSelected) {
                defaults.add(col.header);
            }
        });
        return defaults;
    });

    // Reset selection when dialog opens
    useMemo(() => {
        if (open) {
            const defaults = new Set<string>();
            columnAnalysis.forEach(col => {
                if (col.defaultSelected) {
                    defaults.add(col.header);
                }
            });
            setSelectedColumns(defaults);
        }
    }, [open, columnAnalysis]);

    const toggleColumn = (header: string) => {
        const newSelected = new Set(selectedColumns);
        if (newSelected.has(header)) {
            newSelected.delete(header);
        } else {
            newSelected.add(header);
        }
        setSelectedColumns(newSelected);
    };

    const selectAll = () => {
        setSelectedColumns(new Set(headers));
    };

    const selectNone = () => {
        setSelectedColumns(new Set());
    };

    const selectClean = () => {
        const clean = new Set<string>();
        columnAnalysis.forEach(col => {
            if (col.defaultSelected) {
                clean.add(col.header);
            }
        });
        setSelectedColumns(clean);
    };

    const handleExport = () => {
        if (selectedColumns.size === 0) {
            toast.error('Please select at least one column to export');
            return;
        }

        const exportHeaders = headers.filter(h => selectedColumns.has(h));

        // Build CSV with proper escaping
        const csvRows = [
            exportHeaders.join(','),
            ...data.map(row =>
                exportHeaders.map(h => {
                    const v = row[h] || '';
                    // Escape if contains comma, quote, or newline
                    if (v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')) {
                        return `"${v.replace(/"/g, '""')}"`;
                    }
                    return v;
                }).join(',')
            )
        ];

        // Add BOM for Excel UTF-8 compatibility
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `export_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();

        toast.success(`Exported ${data.length} rows × ${selectedColumns.size} columns`);
        onOpenChange(false);
    };

    const jsonColumnCount = columnAnalysis.filter(c => c.hasJsonData || c.isEnrichment).length;
    const cleanColumnCount = columnAnalysis.filter(c => c.defaultSelected).length;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Download className="w-5 h-5" />
                        Export CSV
                    </DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-hidden flex flex-col gap-4">
                    {/* Quick actions */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <Button variant="outline" size="sm" onClick={selectAll}>
                            Select All ({headers.length})
                        </Button>
                        <Button variant="outline" size="sm" onClick={selectClean}>
                            Clean Only ({cleanColumnCount})
                        </Button>
                        <Button variant="outline" size="sm" onClick={selectNone}>
                            None
                        </Button>
                    </div>

                    {/* Info about JSON columns */}
                    {jsonColumnCount > 0 && (
                        <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm">
                            <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                            <div>
                                <span className="font-medium text-amber-700 dark:text-amber-300">
                                    {jsonColumnCount} JSON/enrichment column{jsonColumnCount > 1 ? 's' : ''} detected
                                </span>
                                <p className="text-muted-foreground text-xs mt-1">
                                    These are auto-unchecked. Use "Select All" to include them.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Column list */}
                    <div className="flex-1 overflow-y-auto border rounded-lg">
                        <div className="divide-y">
                            {columnAnalysis.map(col => (
                                <div
                                    key={col.header}
                                    className={`flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer ${col.isEnrichment || col.hasJsonData ? 'bg-muted/30' : ''
                                        }`}
                                    onClick={() => toggleColumn(col.header)}
                                >
                                    <Checkbox
                                        checked={selectedColumns.has(col.header)}
                                        onCheckedChange={() => toggleColumn(col.header)}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <Label className="cursor-pointer truncate block">
                                            {col.header}
                                        </Label>
                                    </div>
                                    {(col.isEnrichment || col.hasJsonData) && (
                                        <span className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                                            <FileJson className="w-3 h-3" />
                                            {col.isLargeJson ? `${Math.round(col.dataSize / 1024)}KB` : 'JSON'}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <DialogFooter className="flex-shrink-0">
                    <div className="flex items-center justify-between w-full">
                        <span className="text-sm text-muted-foreground">
                            {selectedColumns.size} of {headers.length} columns
                        </span>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleExport} disabled={selectedColumns.size === 0}>
                                <Download className="w-4 h-4 mr-2" />
                                Export
                            </Button>
                        </div>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
