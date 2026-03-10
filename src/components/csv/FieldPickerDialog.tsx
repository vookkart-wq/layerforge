import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    EnrichmentData,
    getEnrichmentFields,
    getEnrichmentValue,
    ENRICHED_COLUMN_PREFIX
} from '@/services/apifyService';

interface FieldPickerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    enrichmentColumn: string;
    data: Record<string, string>[];
    onFieldSelect: (fieldReference: string) => void;
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
        if (value.length > 80) return value.substring(0, 80) + '...';
        return value;
    }
    if (typeof value === 'object') {
        return JSON.stringify(value).substring(0, 80) + '...';
    }
    return String(value);
}

// Find first valid enrichment data from a column
function getFirstEnrichmentData(data: Record<string, string>[], columnName: string): EnrichmentData | null {
    for (const row of data) {
        const value = row[columnName];
        if (value && value.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(value) as EnrichmentData;
                if (parsed && parsed.data && typeof parsed.data === 'object') {
                    return parsed;
                }
            } catch {
                // Not valid JSON, continue
            }
        }
    }
    return null;
}

export function FieldPickerDialog({
    open,
    onOpenChange,
    enrichmentColumn,
    data,
    onFieldSelect
}: FieldPickerDialogProps) {
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

    // Get enrichment data from first row that has it
    const enrichment = useMemo(() => {
        if (!open) return null;
        return getFirstEnrichmentData(data, enrichmentColumn);
    }, [open, data, enrichmentColumn]);

    // Build field tree from enrichment data
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

    const handleInsertField = (fieldPath: string) => {
        // Create the field reference in format {columnName.fieldPath}
        const fieldReference = `${enrichmentColumn}.${fieldPath}`;
        onFieldSelect(fieldReference);
        onOpenChange(false);
    };

    const renderFieldNode = (node: FieldNode, depth: number = 0): React.ReactNode => {
        const isExpanded = expandedNodes.has(node.path);
        const hasChildren = node.children.length > 0;

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

                    {/* Insert button */}
                    {node.isLeaf && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs shrink-0"
                            onClick={() => handleInsertField(node.path)}
                        >
                            <Plus className="w-3 h-3 mr-1" />
                            Insert
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

    // Get display name for the column
    const displayName = enrichmentColumn.replace(ENRICHED_COLUMN_PREFIX, '');

    if (!enrichment) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>No Enrichment Data</DialogTitle>
                        <DialogDescription>
                            No valid enrichment data found in column "{displayName}".
                        </DialogDescription>
                    </DialogHeader>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        📊 Select Field from {displayName}
                    </DialogTitle>
                    <DialogDescription>
                        Click "Insert" to add a field reference to your AI prompt
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-auto border rounded-lg p-2 space-y-1">
                    {fieldTree.map(node => renderFieldNode(node))}
                </div>

                <div className="flex justify-between items-center pt-2 border-t">
                    <span className="text-sm text-muted-foreground">
                        Click "Insert" to add {'{'}columnName.field{'}'} to your prompt
                    </span>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
