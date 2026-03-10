import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Sparkles, Play, Settings, AlertCircle, Loader2, Trash2, Wand2, Save, X, Plus, Minus, Columns } from 'lucide-react';
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
import { FieldPickerDialog } from './FieldPickerDialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useCSVStore } from '@/stores/useCSVStore';
import { toast } from 'sonner';
import { ENRICHED_COLUMN_PREFIX } from '@/services/apifyService';
import {
    getAISettings,
    saveAISettings,
    clearAISettings,
    setAIColumnConfig,
    getAIColumnConfig,
    processRowsWithAI,
    extractColumnReferences,
    validatePromptColumns,
    getAvailableModels,
    getSavedPromptTemplates,
    savePromptTemplate,
    deletePromptTemplate,
    getApiKeyForProvider,
    parseJsonArrayResponse,
    type AIProvider,
    type SavedPromptTemplate
} from '@/services/aiService';

interface AIColumnDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    displayOrder?: number[];  // Sorted/filtered row indices from display
    initialRowRange?: string; // Pre-fill row range
    continueColumnName?: string; // If set, pre-fill dialog to continue processing this column
}

// Prompt templates for common use cases
const PROMPT_TEMPLATES = [
    {
        name: 'Personalized Opening Line',
        prompt: 'Based on the following information about a person, write a personalized and engaging opening line for a cold email (1-2 sentences max, be specific and reference something unique about them):\n\nName: {name}\nCompany: {company}\nTitle: {title}\nAbout/Bio: {about}\n\nOpening line:'
    },
    {
        name: 'Company Research Summary',
        prompt: 'Based on this company description, provide a 1-sentence summary of what the company does and who they serve:\n\nCompany: {company}\nDescription: {description}\n\nSummary:'
    },
    {
        name: 'ICP Match Score',
        prompt: 'Based on the following lead information, rate how well they match an ideal B2B SaaS customer (1-10) and explain why in one sentence:\n\nTitle: {title}\nCompany: {company}\nIndustry: {industry}\n\nScore and reason:'
    },
    {
        name: 'LinkedIn Connection Request',
        prompt: 'Write a short, personalized LinkedIn connection request (under 200 characters) for:\n\nName: {name}\nTitle: {title}\nCompany: {company}\n\nConnection request:'
    }
];

// Global AI processing state for cancel functionality
export const aiProcessingState = {
    isProcessing: false,
    columnName: '',
    processedCount: 0,
    totalCount: 0,
    abortController: null as AbortController | null,
    listeners: new Set<() => void>(),

    start(columnName: string, totalCount: number): AbortController {
        this.isProcessing = true;
        this.columnName = columnName;
        this.processedCount = 0;
        this.totalCount = totalCount;
        this.abortController = new AbortController();
        this.notify();
        return this.abortController;
    },

    update(processedCount: number) {
        this.processedCount = processedCount;
        this.notify();
    },

    cancel() {
        this.abortController?.abort();
        this.finish();
    },

    finish() {
        this.isProcessing = false;
        this.abortController = null;
        this.notify();
    },

    notify() {
        this.listeners.forEach(fn => fn());
    },

    subscribe(fn: () => void) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
};

// Helper function to parse row range input like "1-5, 10, 15-20"
// Returns array of 0-indexed row numbers
function parseRowRange(rangeStr: string, maxRows: number): number[] {
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

// Helper to check if a column is an enrichment/JSON column
function isEnrichmentColumn(columnName: string): boolean {
    return columnName.startsWith(ENRICHED_COLUMN_PREFIX);
}

// Helper to check if enrichment column has valid JSON data
function hasEnrichmentData(data: Record<string, string>[], columnName: string): boolean {
    for (const row of data) {
        const value = row[columnName];
        if (value && value.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(value);
                if (parsed && parsed.data && typeof parsed.data === 'object') {
                    return true;
                }
            } catch {
                // Not valid JSON
            }
        }
    }
    return false;
}

// Helper to extract available JSON fields from a column's data
function getJsonFieldsFromData(data: Record<string, string>[], columnName: string): string[] {
    // Find the first non-empty value that looks like JSON
    for (const row of data) {
        const value = row[columnName];
        if (value && value.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(value);
                if (typeof parsed === 'object' && parsed !== null) {
                    // Get all keys, including nested ones (one level deep)
                    const fields: string[] = [];
                    for (const key of Object.keys(parsed)) {
                        const val = parsed[key];
                        if (val !== null && val !== undefined) {
                            if (typeof val === 'object' && !Array.isArray(val)) {
                                // Nested object - add nested fields
                                for (const nestedKey of Object.keys(val)) {
                                    fields.push(`${key}.${nestedKey}`);
                                }
                            } else {
                                fields.push(key);
                            }
                        }
                    }
                    return fields.sort();
                }
            } catch {
                // Not valid JSON
            }
        }
    }
    return [];
}

export function AIColumnDialog({ open, onOpenChange, displayOrder, initialRowRange = '', continueColumnName }: AIColumnDialogProps) {
    const { headers, data, updateCell, addColumn } = useCSVStore();
    const aiSettings = getAISettings();

    // Dialog state
    const [columnName, setColumnName] = useState('ai_output');
    const [prompt, setPrompt] = useState('');
    const [rowCount, setRowCount] = useState(5);
    const [rowRange, setRowRange] = useState(initialRowRange);  // e.g., "1-5, 10, 15-20"
    const [concurrency, setConcurrency] = useState(5);  // Batch size

    // Multi-column output state
    const [outputColumns, setOutputColumns] = useState<Array<{ name: string, description: string }>>([]);
    const [multiColumnPrefix, setMultiColumnPrefix] = useState('result');
    const [itemCount, setItemCount] = useState(1);  // Number of items (1 = single object, >1 = sequence/list)

    // Derived: multi-column mode is active when user has defined output columns
    const isMultiColumnMode = outputColumns.length > 0;
    // For backward compat with existing parseJsonArrayResponse logic
    const parseJsonOutput = isMultiColumnMode;
    const jsonColumnPrefix = multiColumnPrefix;

    // Sync rowRange when initialRowRange changes or dialog opens
    useEffect(() => {
        if (initialRowRange) {
            setRowRange(initialRowRange);
        }
    }, [initialRowRange]);

    // Pre-fill settings when continuing an existing column
    useEffect(() => {
        if (open && continueColumnName) {
            const config = getAIColumnConfig(continueColumnName);
            if (!config) return;

            // Detect multi-column mode from column name pattern (e.g. result_1_industry)
            const match = continueColumnName.match(/^(.+)_(\d+)_(.+)$/);
            if (match) {
                const prefix = match[1];
                setMultiColumnPrefix(prefix);

                // Reconstruct output columns by scanning existing headers for sibling columns
                const currentHeaders = useCSVStore.getState().headers;
                const siblingPattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)_(.+)$`);
                const fieldMap = new Map<string, Set<string>>();
                let maxItem = 0;

                currentHeaders.forEach(h => {
                    const m = h.match(siblingPattern);
                    if (m) {
                        const itemNum = parseInt(m[1]);
                        const fieldName = m[2];
                        if (!fieldMap.has(fieldName)) fieldMap.set(fieldName, new Set());
                        fieldMap.get(fieldName)!.add(String(itemNum));
                        maxItem = Math.max(maxItem, itemNum);
                    }
                });

                // Build output columns from detected fields
                const detectedColumns = Array.from(fieldMap.keys()).map(name => ({
                    name,
                    description: ''
                }));
                if (detectedColumns.length > 0) {
                    setOutputColumns(detectedColumns);
                    setItemCount(maxItem);
                }

                // Strip the auto-appended JSON instruction from stored prompt
                const jsonInstructionMarker = '\n\nIMPORTANT: Respond with ONLY';
                const markerIdx = config.prompt.indexOf(jsonInstructionMarker);
                const originalPrompt = markerIdx > -1 ? config.prompt.substring(0, markerIdx) : config.prompt;
                setPrompt(originalPrompt);
            } else {
                // Single column mode
                setColumnName(continueColumnName);
                setPrompt(config.prompt);
                setOutputColumns([]);
            }

            hasProcessedOnce.current = true;

            // Auto-set row count to remaining unprocessed rows
            const allIndices = displayOrder || Array.from({ length: data.length }, (_, i) => i);
            const unprocessed = allIndices.filter(i => {
                const val = data[i]?.[continueColumnName]?.trim() || '';
                return !val || val === '❌ Failed';
            });
            if (unprocessed.length > 0) {
                setRowCount(unprocessed.length);
            }
        }
    }, [open, continueColumnName, data, displayOrder]);

    const [isProcessing, setIsProcessing] = useState(false);
    const [processedCount, setProcessedCount] = useState(0);
    const [totalRows, setTotalRows] = useState(0);  // Total rows being processed
    const [showSettings, setShowSettings] = useState(!aiSettings.apiKey);

    // Field picker dialog state for enrichment columns
    const [fieldPickerColumn, setFieldPickerColumn] = useState<string | null>(null);

    // Abort controller for cancellation
    const abortControllerRef = useRef<AbortController | null>(null);

    // Track whether user has processed at least once (to preserve settings on dialog reopen)
    const hasProcessedOnce = useRef(false);

    // Textarea ref for cursor position
    const promptRef = useRef<HTMLTextAreaElement>(null);
    const [cursorPos, setCursorPos] = useState(0);

    // Settings state
    const [provider, setProvider] = useState<AIProvider>(aiSettings.provider);
    const [apiKey, setApiKey] = useState(aiSettings.apiKey);
    const [model, setModel] = useState(aiSettings.model || '');
    const [customModel, setCustomModel] = useState('');
    const [localEndpoint, setLocalEndpoint] = useState(aiSettings.localEndpoint || 'http://localhost:1234/v1/chat/completions');

    // Available models for selected provider
    const availableModels = useMemo(() => getAvailableModels(provider), [provider]);

    // Update model when provider changes (but preserve 'custom' selection)
    useEffect(() => {
        if (model !== 'custom' && !availableModels.includes(model)) {
            setModel(availableModels[0] || '');
        }
    }, [provider, availableModels, model]);

    // Load the saved API key when provider changes
    useEffect(() => {
        const savedApiKey = getApiKeyForProvider(provider);
        setApiKey(savedApiKey);
    }, [provider]);

    // Column references in prompt
    const columnRefs = useMemo(() => extractColumnReferences(prompt), [prompt]);
    const invalidColumns = useMemo(() => validatePromptColumns(prompt, headers), [prompt, headers]);

    // Saved templates state
    const [savedTemplates, setSavedTemplates] = useState<SavedPromptTemplate[]>(() => getSavedPromptTemplates());
    const [showSaveTemplate, setShowSaveTemplate] = useState(false);
    const [templateName, setTemplateName] = useState('');

    // Refresh saved templates when dialog opens
    useEffect(() => {
        if (open) {
            setSavedTemplates(getSavedPromptTemplates());
        }
    }, [open]);

    // Save current prompt as template
    const handleSaveTemplate = useCallback(() => {
        if (!templateName.trim() || !prompt.trim()) {
            toast.error('Please enter a template name and prompt');
            return;
        }
        const newTemplate = savePromptTemplate(templateName, prompt);
        setSavedTemplates(prev => [...prev, newTemplate]);
        setTemplateName('');
        setShowSaveTemplate(false);
        toast.success(`Template "${templateName}" saved!`);
    }, [templateName, prompt]);

    // Delete a saved template
    const handleDeleteTemplate = useCallback((id: string, name: string) => {
        deletePromptTemplate(id);
        setSavedTemplates(prev => prev.filter(t => t.id !== id));
        toast.success(`Template "${name}" deleted`);
    }, []);

    // Insert column reference at cursor position
    const insertColumn = useCallback((col: string) => {
        const insertion = `{${col}}`;
        setPrompt(prev => {
            const before = prev.slice(0, cursorPos);
            const after = prev.slice(cursorPos);
            return before + insertion + after;
        });
        // Update cursor position after insertion
        setCursorPos(prev => prev + insertion.length);
        // Focus back to textarea
        setTimeout(() => promptRef.current?.focus(), 0);
    }, [cursorPos]);

    // Apply template
    const applyTemplate = useCallback((template: typeof PROMPT_TEMPLATES[0]) => {
        setPrompt(template.prompt);
    }, []);

    // Save settings
    const handleSaveSettings = useCallback(() => {
        const finalModel = model === 'custom' ? customModel : model;
        saveAISettings({ provider, apiKey, model: finalModel, localEndpoint });
        setShowSettings(false);
        toast.success('AI settings saved');
    }, [provider, apiKey, model, customModel, localEndpoint]);

    // Clear settings
    const handleClearSettings = useCallback(() => {
        const defaults = clearAISettings();
        setProvider(defaults.provider);
        setApiKey(defaults.apiKey);
        setModel(defaults.model || '');
        setCustomModel('');
        toast.success('AI settings cleared');
    }, []);

    // Process rows
    // Build the JSON instruction to auto-append when multi-column mode is active
    const buildJsonInstruction = useCallback(() => {
        if (outputColumns.length === 0) return '';

        const fieldDescriptions = outputColumns.map(col => {
            if (col.description.trim()) {
                return `"${col.name}" (${col.description})`;
            }
            return `"${col.name}"`;
        }).join(', ');

        const exampleObj = '{' + outputColumns.map(col => `"${col.name}": "..."`).join(', ') + '}';

        if (itemCount > 1) {
            const exampleArray = '[' + Array.from({ length: Math.min(itemCount, 3) }, () => exampleObj).join(', ') + (itemCount > 3 ? ', ...' : '') + ']';
            return `\n\nIMPORTANT: Respond with ONLY a valid JSON array containing exactly ${itemCount} objects. Each object must have these fields: ${fieldDescriptions}. No other text, no markdown, no explanation. Example format:\n${exampleArray}`;
        } else {
            return `\n\nIMPORTANT: Respond with ONLY a valid JSON array containing exactly one object with these fields: ${fieldDescriptions}. No other text, no markdown, no explanation. Example format:\n[${exampleObj}]`;
        }
    }, [outputColumns, itemCount]);

    const handleProcess = useCallback(async () => {
        // Local LLM doesn't need API key
        if (provider !== 'local' && !apiKey) {
            toast.error('Please configure your API key in settings');
            setShowSettings(true);
            return;
        }

        if (!prompt.trim()) {
            toast.error('Please enter a prompt');
            return;
        }

        if (invalidColumns.length > 0) {
            toast.error(`Unknown columns: ${invalidColumns.join(', ')}`);
            return;
        }

        // Validate multi-column mode
        if (isMultiColumnMode) {
            if (!multiColumnPrefix.trim()) {
                toast.error('Please enter a column prefix');
                return;
            }
            const invalidColNames = outputColumns.filter(col => !col.name.trim() || /\s/.test(col.name));
            if (invalidColNames.length > 0) {
                toast.error('Output column names cannot be empty or contain spaces. Use underscores instead.');
                return;
            }
        }

        // Use actual model name (customModel if 'custom' is selected)
        const finalModel = model === 'custom' ? customModel : model;

        // Save settings with correct model
        saveAISettings({ provider, apiKey, model: finalModel });

        // For non-JSON mode, create the column if it doesn't exist
        let actualColumnName = columnName.trim();
        if (!parseJsonOutput) {
            if (!headers.includes(actualColumnName)) {
                addColumn(actualColumnName, '');
            }

            // Track as AI column
            setAIColumnConfig(actualColumnName, {
                columnName: actualColumnName,
                prompt,
                processedRows: new Set(),
                isProcessing: true,
                createdAt: new Date()
            });
        }

        // Get row indices to process - use display order if available (for sorted/filtered data)
        const allIndices = displayOrder || Array.from({ length: data.length }, (_, i) => i);

        // Apply row range filter if specified
        let candidateIndices = allIndices;
        if (rowRange.trim()) {
            const displayPositions = parseRowRange(rowRange, allIndices.length);
            if (displayPositions.length === 0) {
                toast.error('Invalid row range format. Use: 1-5, 10, 15-20');
                return;
            }
            // Select specific display positions (what user sees on screen)
            candidateIndices = displayPositions.map(pos => allIndices[pos]).filter(idx => idx !== undefined);
        }

        // For JSON mode, use a temporary marker column for tracking
        const trackingColumn = parseJsonOutput ? `__json_processing_${jsonColumnPrefix}` : actualColumnName;

        // Filter out rows that already have data or are currently processing
        const maxRows = rowRange.trim() ? candidateIndices.length : Math.min(rowCount, candidateIndices.length);
        const rowIndices = candidateIndices
            .filter(idx => {
                if (parseJsonOutput) {
                    // For JSON mode, check if the first expected column exists and has data
                    // We'll look for any column starting with the prefix
                    const prefixCols = headers.filter(h => h.startsWith(`${jsonColumnPrefix}_1_`));
                    if (prefixCols.length > 0) {
                        const val = data[idx]?.[prefixCols[0]]?.trim() || '';
                        return !val || val === '❌ Failed';
                    }
                    return true; // No columns exist yet, process all
                } else {
                    const val = data[idx]?.[actualColumnName]?.trim() || '';
                    return !val || val === '❌ Failed';  // Include empty or failed cells only
                }
            })
            .slice(0, maxRows);

        if (rowIndices.length === 0) {
            toast.info('All selected rows already have data in these columns');
            return;
        }

        // For non-JSON mode, set loading text in cells
        if (!parseJsonOutput) {
            rowIndices.forEach(idx => {
                updateCell(idx, actualColumnName, '⏳ Processing...');
            });
        }

        // Close dialog immediately - user can keep working
        hasProcessedOnce.current = true;
        onOpenChange(false);
        toast.info(`Processing ${rowIndices.length} rows in background...${parseJsonOutput ? ' (JSON mode)' : ''}`);

        // Start global processing state for cancel functionality
        const processingName = parseJsonOutput ? `${jsonColumnPrefix}_*` : actualColumnName;
        const abortController = aiProcessingState.start(processingName, rowIndices.length);

        // Track created columns for JSON mode
        const createdColumns = new Set<string>();

        // Process in background
        let completedCount = 0;
        try {
            // Build final prompt (auto-append JSON instruction if multi-column mode)
            const finalPrompt = isMultiColumnMode ? prompt + buildJsonInstruction() : prompt;

            await processRowsWithAI(
                data,
                headers,
                finalPrompt,
                rowIndices,
                (completed, total, rowIndex, result) => {
                    completedCount = completed;
                    aiProcessingState.update(completed);

                    if (parseJsonOutput) {
                        // Parse JSON and create/update multiple columns
                        const parsed = parseJsonArrayResponse(result, jsonColumnPrefix);
                        if (parsed) {
                            // Create columns if they don't exist
                            parsed.columns.forEach(colName => {
                                if (!createdColumns.has(colName)) {
                                    // Get current headers fresh from store
                                    const currentHeaders = useCSVStore.getState().headers;
                                    if (!currentHeaders.includes(colName)) {
                                        addColumn(colName, '');
                                    }
                                    createdColumns.add(colName);
                                }
                            });
                            // Update cells with parsed data
                            Object.entries(parsed.data).forEach(([colName, value]) => {
                                updateCell(rowIndex, colName, value);
                            });
                        } else {
                            // JSON parsing failed - put raw result in a fallback column
                            const fallbackCol = `${jsonColumnPrefix}_raw`;
                            if (!createdColumns.has(fallbackCol)) {
                                const currentHeaders = useCSVStore.getState().headers;
                                if (!currentHeaders.includes(fallbackCol)) {
                                    addColumn(fallbackCol, '');
                                }
                                createdColumns.add(fallbackCol);
                            }
                            updateCell(rowIndex, fallbackCol, result);
                        }
                    } else {
                        // Standard single column mode
                        updateCell(rowIndex, actualColumnName, result);
                    }
                },
                concurrency,
                200,
                abortController.signal
            );

            if (abortController.signal.aborted) {
                // Clear hourglass from remaining cells so they can be retried
                if (!parseJsonOutput) {
                    const freshData = useCSVStore.getState().data;
                    rowIndices.forEach(idx => {
                        const currentValue = freshData[idx]?.[actualColumnName];
                        if (currentValue === '⏳ Processing...') {
                            updateCell(idx, actualColumnName, '');
                        }
                    });
                }
                toast.info(`Cancelled after processing ${completedCount} rows`);
            } else {
                // Register columns for "Process More" functionality
                if (parseJsonOutput && createdColumns.size > 0) {
                    // Register the first created column so the play button appears
                    const firstCol = Array.from(createdColumns)[0];
                    setAIColumnConfig(firstCol, {
                        columnName: firstCol,
                        prompt: finalPrompt,
                        processedRows: new Set(rowIndices),
                        isProcessing: false,
                        createdAt: new Date()
                    });
                }

                const successMsg = parseJsonOutput
                    ? `✅ AI enrichment complete! Processed ${rowIndices.length} rows into ${createdColumns.size} columns`
                    : `✅ AI enrichment complete! Processed ${rowIndices.length} rows`;
                toast.success(successMsg);
            }
        } catch (error) {
            // Mark remaining cells as failed
            if (!parseJsonOutput) {
                rowIndices.forEach(idx => {
                    const currentValue = data[idx]?.[actualColumnName];
                    if (currentValue === '⏳ Processing...') {
                        updateCell(idx, actualColumnName, '❌ Failed');
                    }
                });
            }
            toast.error(`AI processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            aiProcessingState.finish();
        }
    }, [apiKey, prompt, invalidColumns, provider, model, customModel, columnName, headers, addColumn, rowCount, rowRange, data, updateCell, onOpenChange, displayOrder, concurrency, isMultiColumnMode, multiColumnPrefix, outputColumns, buildJsonInstruction]);

    // Reset on close
    // Only reset row-specific state on close; preserve prompt/settings to allow reuse
    const handleOpenChange = useCallback((open: boolean) => {
        if (!open && !isProcessing) {
            // Always reset row-specific state
            setRowCount(5);
            setProcessedCount(0);
            setRowRange('');

            // Only reset prompt/columns if user never processed (fresh cancel)
            if (!hasProcessedOnce.current) {
                setColumnName('ai_output');
                setPrompt('');
                setShowSettings(false);
                setOutputColumns([]);
                setMultiColumnPrefix('result');
                setItemCount(1);
            }
        }
        if (!isProcessing) {
            if (open && initialRowRange) {
                setRowRange(initialRowRange);
            }
            onOpenChange(open);
        }
    }, [isProcessing, onOpenChange, initialRowRange]);

    return (
        <>
            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Sparkles className="w-5 h-5" />
                            AI Column Generator
                        </DialogTitle>
                        <DialogDescription>
                            Use AI to generate a new column based on existing data. Use {'{column_name}'} to reference other columns.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 overflow-auto space-y-4 py-4">
                        {/* Settings toggle */}
                        {!showSettings && (
                            <div className="flex items-center justify-between p-2 bg-muted/50 rounded-lg text-sm">
                                <span>
                                    Using <strong>{provider.charAt(0).toUpperCase() + provider.slice(1)}</strong>
                                    {model && <span className="text-muted-foreground"> ({model})</span>}
                                </span>
                                <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>
                                    <Settings className="w-4 h-4 mr-1" />
                                    Settings
                                </Button>
                            </div>
                        )}

                        {/* Settings panel */}
                        {showSettings && (
                            <div className="p-4 border rounded-lg space-y-3 bg-muted/30">
                                <div className="flex items-center justify-between">
                                    <Label className="text-sm font-medium">AI Provider Settings</Label>
                                    {aiSettings.apiKey && (
                                        <Button variant="ghost" size="sm" onClick={() => setShowSettings(false)}>
                                            Cancel
                                        </Button>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <Label className="text-xs text-muted-foreground">Provider</Label>
                                        <Select value={provider} onValueChange={(v) => setProvider(v as AIProvider)}>
                                            <SelectTrigger className="mt-1">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="gemini">Gemini</SelectItem>
                                                <SelectItem value="openai">OpenAI</SelectItem>
                                                <SelectItem value="claude">Claude</SelectItem>
                                                <SelectItem value="deepseek">DeepSeek</SelectItem>
                                                <SelectItem value="groq">Groq</SelectItem>
                                                <SelectItem value="deepinfra">DeepInfra</SelectItem>
                                                <SelectItem value="openrouter">OpenRouter</SelectItem>
                                                <SelectItem value="local">Local LLM (LM Studio)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <Label className="text-xs text-muted-foreground">Model</Label>
                                        <Select value={model} onValueChange={setModel}>
                                            <SelectTrigger className="mt-1">
                                                <SelectValue placeholder="Select model..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {availableModels.map(m => (
                                                    <SelectItem key={m} value={m}>{m}</SelectItem>
                                                ))}
                                                <SelectItem value="custom">Custom model...</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {model === 'custom' && (
                                            <Input
                                                value={customModel}
                                                onChange={(e) => setCustomModel(e.target.value)}
                                                placeholder="Enter custom model name..."
                                                className="mt-1"
                                            />
                                        )}
                                    </div>
                                </div>

                                {/* API Key - not needed for local LLM */}
                                {provider !== 'local' && (
                                    <div>
                                        <Label className="text-xs text-muted-foreground">API Key</Label>
                                        <Input
                                            type="password"
                                            value={apiKey}
                                            onChange={(e) => setApiKey(e.target.value)}
                                            placeholder={`Enter your ${provider} API key...`}
                                            className="mt-1"
                                        />
                                    </div>
                                )}

                                {/* Local LLM endpoint URL */}
                                {provider === 'local' && (
                                    <div>
                                        <Label className="text-xs text-muted-foreground">Server URL</Label>
                                        <Input
                                            value={localEndpoint}
                                            onChange={(e) => setLocalEndpoint(e.target.value)}
                                            placeholder="http://localhost:1234/v1/chat/completions"
                                            className="mt-1"
                                        />
                                        <p className="text-xs text-muted-foreground mt-1">
                                            LM Studio URL. Make sure the server is running.
                                        </p>
                                    </div>
                                )}

                                <div className="flex gap-2">
                                    <Button size="sm" onClick={handleSaveSettings} disabled={(provider !== 'local' && !apiKey) || (model === 'custom' && !customModel)}>
                                        Save Settings
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={handleClearSettings}>
                                        <Trash2 className="w-3 h-3 mr-1" />
                                        Clear All
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* Column name - adapts based on mode */}
                        <div>
                            <Label>{isMultiColumnMode ? 'Column Prefix' : 'New Column Name'}</Label>
                            <Input
                                value={isMultiColumnMode ? multiColumnPrefix : columnName}
                                onChange={(e) => isMultiColumnMode ? setMultiColumnPrefix(e.target.value) : setColumnName(e.target.value)}
                                placeholder={isMultiColumnMode ? 'result' : 'ai_output'}
                                className="mt-1"
                            />
                            {isMultiColumnMode && (
                                <p className="text-xs text-muted-foreground mt-1">
                                    Columns created: {outputColumns.map(col => <code key={col.name} className="mr-1">{multiColumnPrefix}_1_{col.name}</code>)}
                                </p>
                            )}
                        </div>

                        {/* Multi-Column Output Builder */}
                        <div className="p-3 border rounded-lg space-y-3 bg-muted/20">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Columns className="w-4 h-4 text-primary" />
                                    <Label className="text-sm font-medium">Multi-Column Output</Label>
                                </div>
                                {outputColumns.length === 0 ? (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-xs h-7"
                                        onClick={() => setOutputColumns([{ name: '', description: '' }])}
                                    >
                                        <Plus className="w-3 h-3 mr-1" />
                                        Add Output Columns
                                    </Button>
                                ) : (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-xs h-7 text-destructive hover:text-destructive"
                                        onClick={() => { setOutputColumns([]); setItemCount(1); }}
                                    >
                                        <X className="w-3 h-3 mr-1" />
                                        Disable
                                    </Button>
                                )}
                            </div>

                            {outputColumns.length === 0 && (
                                <p className="text-xs text-muted-foreground">
                                    Split AI output into multiple columns. Define the column names you want and the app handles the rest.
                                </p>
                            )}

                            {outputColumns.length > 0 && (
                                <>
                                    <div className="space-y-2">
                                        {outputColumns.map((col, index) => (
                                            <div key={index} className="flex items-center gap-2">
                                                <Input
                                                    value={col.name}
                                                    onChange={(e) => {
                                                        const updated = [...outputColumns];
                                                        updated[index] = { ...col, name: e.target.value.replace(/\s/g, '_') };
                                                        setOutputColumns(updated);
                                                    }}
                                                    placeholder="column_name"
                                                    className="h-8 text-xs flex-1"
                                                />
                                                <Input
                                                    value={col.description}
                                                    onChange={(e) => {
                                                        const updated = [...outputColumns];
                                                        updated[index] = { ...col, description: e.target.value };
                                                        setOutputColumns(updated);
                                                    }}
                                                    placeholder="description (optional)"
                                                    className="h-8 text-xs flex-[2]"
                                                />
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                                    onClick={() => setOutputColumns(outputColumns.filter((_, i) => i !== index))}
                                                >
                                                    <Minus className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-xs h-7 w-full"
                                        onClick={() => setOutputColumns([...outputColumns, { name: '', description: '' }])}
                                    >
                                        <Plus className="w-3 h-3 mr-1" />
                                        Add Column
                                    </Button>

                                    {/* Item count - for sequences like email steps */}
                                    <div className="flex items-center gap-2 pt-1 border-t">
                                        <Label className="text-xs text-muted-foreground whitespace-nowrap">Items per row:</Label>
                                        <div className="flex items-center gap-1">
                                            <Button variant="ghost" size="sm" className={`h-6 px-2 text-xs ${itemCount === 1 ? 'bg-primary text-primary-foreground' : ''}`} onClick={() => setItemCount(1)}>1</Button>
                                            <Button variant="ghost" size="sm" className={`h-6 px-2 text-xs ${itemCount === 3 ? 'bg-primary text-primary-foreground' : ''}`} onClick={() => setItemCount(3)}>3</Button>
                                            <Button variant="ghost" size="sm" className={`h-6 px-2 text-xs ${itemCount === 5 ? 'bg-primary text-primary-foreground' : ''}`} onClick={() => setItemCount(5)}>5</Button>
                                            <Input
                                                type="number"
                                                min={1}
                                                max={20}
                                                value={itemCount}
                                                onChange={(e) => setItemCount(Math.min(Math.max(Number(e.target.value) || 1, 1), 20))}
                                                className="h-6 w-14 text-xs"
                                            />
                                        </div>
                                        <span className="text-xs text-muted-foreground">
                                            {itemCount === 1 ? '(single result)' : `(${itemCount}-step sequence)`}
                                        </span>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Template shortcuts */}
                        <div>
                            <Label className="text-xs text-muted-foreground">Quick Templates</Label>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {PROMPT_TEMPLATES.map(t => (
                                    <Button
                                        key={t.name}
                                        variant="outline"
                                        size="sm"
                                        className="text-xs h-7"
                                        onClick={() => applyTemplate(t)}
                                    >
                                        {t.name}
                                    </Button>
                                ))}
                            </div>

                            {/* Saved templates */}
                            {savedTemplates.length > 0 && (
                                <div className="mt-2">
                                    <Label className="text-xs text-muted-foreground">Saved Templates</Label>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {savedTemplates.map(t => (
                                            <div key={t.id} className="inline-flex items-center gap-0.5 group">
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    className="text-xs h-7 pr-1 rounded-r-none"
                                                    onClick={() => setPrompt(t.prompt)}
                                                >
                                                    {t.name}
                                                </Button>
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    className="text-xs h-7 px-1 rounded-l-none hover:bg-destructive hover:text-destructive-foreground"
                                                    onClick={() => handleDeleteTemplate(t.id, t.name)}
                                                >
                                                    <X className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Save template button/input */}
                            <div className="mt-2">
                                {showSaveTemplate ? (
                                    <div className="flex items-center gap-2">
                                        <Input
                                            value={templateName}
                                            onChange={(e) => setTemplateName(e.target.value)}
                                            placeholder="Template name..."
                                            className="h-7 text-xs flex-1"
                                            onKeyDown={(e) => e.key === 'Enter' && handleSaveTemplate()}
                                            autoFocus
                                        />
                                        <Button
                                            size="sm"
                                            className="h-7 text-xs"
                                            onClick={handleSaveTemplate}
                                            disabled={!templateName.trim() || !prompt.trim()}
                                        >
                                            <Save className="w-3 h-3 mr-1" />
                                            Save
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 text-xs px-2"
                                            onClick={() => {
                                                setShowSaveTemplate(false);
                                                setTemplateName('');
                                            }}
                                        >
                                            <X className="w-3 h-3" />
                                        </Button>
                                    </div>
                                ) : (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-xs h-7"
                                        onClick={() => setShowSaveTemplate(true)}
                                        disabled={!prompt.trim()}
                                    >
                                        <Save className="w-3 h-3 mr-1" />
                                        Save Current Prompt as Template
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Column insertion */}
                        <div>
                            <Label className="text-xs text-muted-foreground">Insert Column Reference</Label>
                            <p className="text-xs text-muted-foreground mb-1">
                                Click enrichment columns (📊) to pick specific fields
                            </p>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {headers.map(h => {
                                    const isEnrichment = isEnrichmentColumn(h);
                                    const jsonFields = isEnrichment ? getJsonFieldsFromData(data, h) : [];

                                    if (isEnrichment && hasEnrichmentData(data, h)) {
                                        // Enrichment column with JSON data - button to open field picker dialog
                                        return (
                                            <Button
                                                key={h}
                                                variant="secondary"
                                                size="sm"
                                                className="text-xs h-6 px-2 bg-orange-500/10 border-orange-500/30 hover:bg-orange-500/20"
                                                onClick={() => setFieldPickerColumn(h)}
                                            >
                                                <span>📊 {h.replace(ENRICHED_COLUMN_PREFIX, '')}</span>
                                            </Button>
                                        );
                                    }

                                    // Regular column - simple button
                                    return (
                                        <Button
                                            key={h}
                                            variant="secondary"
                                            size="sm"
                                            className="text-xs h-6 px-2"
                                            onClick={() => insertColumn(h)}
                                        >
                                            {'{' + h + '}'}
                                        </Button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Prompt textarea */}
                        <div>
                            <Label>Prompt</Label>
                            <textarea
                                ref={promptRef}
                                value={prompt}
                                onChange={(e) => {
                                    setPrompt(e.target.value);
                                    setCursorPos(e.target.selectionStart);
                                }}
                                onSelect={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart)}
                                onClick={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart)}
                                onKeyUp={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart)}
                                placeholder="Write your prompt here. Use {column_name} to reference data from each row..."
                                className="mt-1 w-full min-h-40 max-h-96 px-3 py-2 text-sm border rounded-md resize-y focus:outline-none focus:ring-2 focus:ring-primary"
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

                        {/* Row count */}
                        <div>
                            <Label>Rows to Process</Label>
                            <div className="flex items-center gap-2 mt-1">
                                <Input
                                    type="number"
                                    min={1}
                                    max={data.length}
                                    value={rowCount}
                                    onChange={(e) => setRowCount(Math.min(Number(e.target.value) || 1, data.length))}
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
                            <p className="text-xs text-muted-foreground mt-1">
                                Rows with existing data in this column will be skipped.
                            </p>
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

                        {/* Batch size (concurrency) control */}
                        <div>
                            <Label>Batch Size (Parallel Requests)</Label>
                            <div className="flex items-center gap-2 mt-1">
                                <Input
                                    type="number"
                                    min={1}
                                    max={20}
                                    value={concurrency}
                                    onChange={(e) => setConcurrency(Math.min(Math.max(Number(e.target.value) || 1, 1), 20))}
                                    className="w-20"
                                />
                                <Button variant="ghost" size="sm" onClick={() => setConcurrency(1)}>1</Button>
                                <Button variant="ghost" size="sm" onClick={() => setConcurrency(5)}>5</Button>
                                <Button variant="ghost" size="sm" onClick={() => setConcurrency(10)}>10</Button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                Higher = faster, but may hit rate limits. Default: 5
                            </p>
                        </div>

                        {/* Processing progress */}
                        {isProcessing && (
                            <div className="p-3 bg-primary/5 rounded-lg">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span className="text-sm font-medium">
                                            Processing {processedCount} of {totalRows}...
                                        </span>
                                    </div>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => abortControllerRef.current?.abort()}
                                    >
                                        Cancel
                                    </Button>
                                </div>
                                <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-primary transition-all"
                                        style={{ width: `${totalRows > 0 ? (processedCount / totalRows) * 100 : 0}%` }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={isProcessing}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleProcess}
                            disabled={!prompt.trim() || (!isMultiColumnMode && !columnName.trim()) || (isMultiColumnMode && !multiColumnPrefix.trim()) || invalidColumns.length > 0 || isProcessing}
                        >
                            {isProcessing ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <Wand2 className="w-4 h-4 mr-2" />
                                    {rowRange.trim()
                                        ? `Generate ${parseRowRange(rowRange, data.length).length} Specific Rows`
                                        : `Generate ${Math.min(rowCount, data.length)} Rows`
                                    }
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Field picker dialog for enrichment columns */}
            <FieldPickerDialog
                open={fieldPickerColumn !== null}
                onOpenChange={(open) => !open && setFieldPickerColumn(null)}
                enrichmentColumn={fieldPickerColumn || ''}
                data={data}
                onFieldSelect={insertColumn}
            />
        </>
    );
}
