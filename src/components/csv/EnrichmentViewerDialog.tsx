import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Plus, Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useCSVStore } from '@/stores/useCSVStore';
import {
    EnrichmentData,
    getEnrichmentFields,
    getEnrichmentValue,
    isEnrichmentColumn
} from '@/services/apifyService';
import { toast } from 'sonner';

interface EnrichmentViewerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    enrichment: EnrichmentData | null;
    rowIndex: number;
    enrichmentColumn: string;  // The column name where enrichment data is stored
}

interface FieldNode {
    name: string;
    path: string;
    value: unknown;
    children: FieldNode[];
    isLeaf: boolean;
}

// Build tree structure from enrichment data
function buildFieldTree(enrichment: EnrichmentData): FieldNode[] {
    const root: FieldNode[] = [];
    const fields = getEnrichmentFields(enrichment);

    fields.forEach(path => {
        const parts = path.split('.');
        let current = root;
        let pathSoFar = '';

        parts.forEach((part, idx) => {
            pathSoFar = pathSoFar ? `${pathSoFar}.${part}` : part;
            const isLast = idx === parts.length - 1;

            let node = current.find(n => n.name === part);
            if (!node) {
                const value = isLast ? getEnrichmentValue(enrichment, pathSoFar) : undefined;
                node = {
                    name: part,
                    path: pathSoFar,
                    value,
                    children: [],
                    isLeaf: isLast
                };
                current.push(node);
            }
            current = node.children;
        });
    });

    return root;
}

// Format value for display
function formatValue(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'string') {
        if (value.length > 100) return value.substring(0, 100) + '...';
        return value;
    }
    if (typeof value === 'object') {
        return JSON.stringify(value).substring(0, 100) + '...';
    }
    return String(value);
}

export function EnrichmentViewerDialog({
    open,
    onOpenChange,
    enrichment,
    rowIndex,
    enrichmentColumn
}: EnrichmentViewerDialogProps) {
    const { data, headers, addColumn, updateCell } = useCSVStore();
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

    const fieldTree = useMemo(() => {
        if (!enrichment) return [];
        return buildFieldTree(enrichment);
    }, [enrichment]);

    const toggleExpand = (path: string) => {
        setExpandedNodes(prev => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    };

    const handleAddColumn = (fieldPath: string) => {
        if (!enrichment || !enrichmentColumn) return;

        // Create column name from path (replace dots with underscores)
        const columnName = fieldPath.replace(/\./g, '_');

        // Check if column already exists
        if (headers.includes(columnName)) {
            // Just populate values from enrichment - scan all enrichment columns
            let updatedCount = 0;
            data.forEach((row, idx) => {
                // Look in ALL enrichment columns for this field
                headers.filter(isEnrichmentColumn).forEach(enrichCol => {
                    const rowEnrichmentStr = row[enrichCol];
                    if (rowEnrichmentStr) {
                        try {
                            const rowEnrichment = JSON.parse(rowEnrichmentStr) as EnrichmentData;
                            const value = getEnrichmentValue(rowEnrichment, fieldPath);
                            if (value !== undefined) {
                                updateCell(idx, columnName, String(value));
                                updatedCount++;
                            }
                        } catch {
                            // Skip invalid rows
                        }
                    }
                });
            });
            toast.success(`Updated "${columnName}" with ${updatedCount} values`);
        } else {
            // Add new column
            addColumn(columnName, '');

            // Populate from all enriched rows - scan all enrichment columns
            setTimeout(() => {
                let addedCount = 0;
                data.forEach((row, idx) => {
                    headers.filter(isEnrichmentColumn).forEach(enrichCol => {
                        const rowEnrichmentStr = row[enrichCol];
                        if (rowEnrichmentStr) {
                            try {
                                const rowEnrichment = JSON.parse(rowEnrichmentStr) as EnrichmentData;
                                const value = getEnrichmentValue(rowEnrichment, fieldPath);
                                if (value !== undefined) {
                                    updateCell(idx, columnName, String(value));
                                    addedCount++;
                                }
                            } catch {
                                // Skip invalid rows
                            }
                        }
                    });
                });
                toast.success(`Added column "${columnName}" with ${addedCount} values`);
            }, 50);
        }
    };

    const renderFieldNode = (node: FieldNode, depth: number = 0): React.ReactNode => {
        const isExpanded = expandedNodes.has(node.path);
        const hasChildren = node.children.length > 0;
        const columnExists = headers.includes(node.path.replace(/\./g, '_'));

        return (
            <div key={node.path}>
                <div
                    className={`flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 ${depth > 0 ? 'ml-4' : ''}`}
                >
                    {/* Expand/collapse button */}
                    {hasChildren ? (
                        <button
                            onClick={() => toggleExpand(node.path)}
                            className="p-0.5 hover:bg-muted rounded"
                        >
                            {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            ) : (
                                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                            )}
                        </button>
                    ) : (
                        <div className="w-5" />
                    )}

                    {/* Field name */}
                    <span className="font-medium text-sm min-w-[120px]">{node.name}</span>

                    {/* Value preview (only for leaf nodes) */}
                    {node.isLeaf && (
                        <span className="text-sm text-muted-foreground flex-1 truncate">
                            {formatValue(node.value)}
                        </span>
                    )}

                    {/* Add as column button */}
                    {node.isLeaf && (
                        <Button
                            variant={columnExists ? "secondary" : "outline"}
                            size="sm"
                            className="h-7 text-xs shrink-0"
                            onClick={() => handleAddColumn(node.path)}
                        >
                            {columnExists ? (
                                <>
                                    <Check className="w-3 h-3 mr-1" />
                                    Update
                                </>
                            ) : (
                                <>
                                    <Plus className="w-3 h-3 mr-1" />
                                    Add Column
                                </>
                            )}
                        </Button>
                    )}
                </div>

                {/* Children */}
                {hasChildren && isExpanded && (
                    <div className="border-l border-muted ml-3">
                        {node.children.map(child => renderFieldNode(child, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    if (!enrichment) return null;

    const scrapedDate = new Date(enrichment.scrapedAt).toLocaleString();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-purple-500" />
                        Enrichment Data
                    </DialogTitle>
                    <DialogDescription>
                        Row {rowIndex + 1} • Scraped {scrapedDate} via {enrichment.sourceName}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-auto border rounded-lg p-2 space-y-1">
                    {fieldTree.map(node => renderFieldNode(node))}
                </div>

                <div className="flex justify-between items-center pt-2 border-t">
                    <span className="text-sm text-muted-foreground">
                        Click "Add Column" to extract any field to a new column
                    </span>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
