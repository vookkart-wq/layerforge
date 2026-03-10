import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Play, Settings, AlertCircle, Loader2, ChevronRight, Database, Save, Pencil, Trash2, Eye, EyeOff, RefreshCw, Check } from 'lucide-react';
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
import {
    getApifySettings,
    saveApifySettings,
    runApifyActor,
    detectLinkedInColumn,
    extractLinkedInUsernames,
    extractLinkedInCompanyUrls,
    apifyProcessingState,
    APIFY_PRESETS,
    getEnrichmentColumnName,
    getEnrichmentDisplayName,
    hasEnrichmentFromSource,
    type EnrichmentData,
    type CustomActorPreset,
    type PendingApifyResults,
    loadCustomPresets,
    saveCustomPreset,
    deleteCustomPreset,
    expandTemplate,
    getTemplatePlaceholders,
    matchResultsToRows,
} from '@/services/apifyService';

interface ApifyDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    displayOrder?: number[];
    initialRowRange?: string;
}

type Step = 'settings' | 'configure' | 'running' | 'mapping';

const LINKEDIN_PROFILE_SCRAPER_ID = 'apimaestro/linkedin-profile-batch-scraper-no-cookies-required';
const LINKEDIN_COMPANY_SCRAPER_ID = 'harvestapi/linkedin-company';

// Helper to stringify values
function stringifyValue(val: unknown): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) {
        return val.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(', ');
    }
    if (typeof val === 'object') {
        return JSON.stringify(val);
    }
    return String(val);
}

// Parse row range string like "1-10, 15, 20-25" into row indices (0-based)
function parseRowRange(rangeStr: string, maxRows: number): number[] {
    if (!rangeStr.trim()) return [];
    const indices: Set<number> = new Set();
    const parts = rangeStr.split(',').map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
        if (part.includes('-')) {
            const [startStr, endStr] = part.split('-').map(s => s.trim());
            const start = Math.max(1, parseInt(startStr, 10) || 1);
            const end = Math.min(maxRows, parseInt(endStr, 10) || maxRows);
            for (let i = start; i <= end; i++) indices.add(i - 1);
        } else {
            const num = parseInt(part, 10);
            if (num >= 1 && num <= maxRows) indices.add(num - 1);
        }
    }
    return Array.from(indices).sort((a, b) => a - b);
}

// Build tree structure from flat column paths
interface ColumnNode {
    name: string;
    path: string;
    isLeaf: boolean;
    children: ColumnNode[];
}

function buildColumnTree(columns: string[]): ColumnNode[] {
    const root: ColumnNode[] = [];

    const sorted = [...columns].sort((a, b) => {
        const aDepth = a.split('.').length;
        const bDepth = b.split('.').length;
        if (aDepth !== bDepth) return aDepth - bDepth;
        return a.localeCompare(b);
    });

    sorted.forEach(col => {
        const parts = col.split('.');
        let current = root;
        let pathSoFar = '';

        parts.forEach((part, idx) => {
            pathSoFar = pathSoFar ? `${pathSoFar}.${part}` : part;
            const isLastPart = idx === parts.length - 1;

            let node = current.find(n => n.name === part);
            if (!node) {
                node = { name: part, path: pathSoFar, isLeaf: isLastPart, children: [] };
                current.push(node);
            } else if (!isLastPart) {
                node.isLeaf = false;
            }
            current = node.children;
        });
    });

    return root;
}

// Normalize URLs for matching - handles linkedin.com variations
function normalizeUrl(url: string): string {
    let normalized = url.toLowerCase().trim();
    normalized = normalized.replace(/^https?:\/\//, '');
    normalized = normalized.replace(/^www\./, '');
    normalized = normalized.replace(/\/$/, '');
    return normalized;
}

export function ApifyDialog({ open, onOpenChange, displayOrder, initialRowRange }: ApifyDialogProps) {
    const { headers, data, addColumn, updateCell } = useCSVStore();

    // Settings
    const [apiToken, setApiToken] = useState('');
    const [showToken, setShowToken] = useState(false);

    // Actor configuration
    const [selectedPreset, setSelectedPreset] = useState<string>(LINKEDIN_PROFILE_SCRAPER_ID);
    const [actorId, setActorId] = useState(LINKEDIN_PROFILE_SCRAPER_ID);
    const [actorInput, setActorInput] = useState('{"usernames": []}');

    // LinkedIn-specific
    const [linkedInColumn, setLinkedInColumn] = useState<string>('');
    const [detectedColumn, setDetectedColumn] = useState<string | null>(null);

    // Row range selection
    const [rowRange, setRowRange] = useState<string>('');
    const [rowRangeMode, setRowRangeMode] = useState<'all' | 'range'>('all');

    // Running state
    const [step, setStep] = useState<Step>('settings');
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState('');
    const [error, setError] = useState<string | null>(null);

    // Custom preset & matching state
    const [showSavePreset, setShowSavePreset] = useState(false);
    const [presetName, setPresetName] = useState('');
    const [presetDescription, setPresetDescription] = useState('');
    const [matchResultField, setMatchResultField] = useState('');
    const [matchCsvColumn, setMatchCsvColumn] = useState('');
    const [showPreview, setShowPreview] = useState(false);
    const [customPresetVersion, setCustomPresetVersion] = useState(0);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Mapping step state
    const [mappingItems, setMappingItems] = useState<Record<string, unknown>[]>([]);
    const [mappingResultField, setMappingResultField] = useState('');
    const [mappingCsvColumn, setMappingCsvColumn] = useState('');
    const [mappingMeta, setMappingMeta] = useState<{ actorId: string; actorName: string; enrichColumnName: string; enrichDisplayName: string; rowIndices: number[] } | null>(null);
    const [mappingPreviewCount, setMappingPreviewCount] = useState(0);

    // Detect if a custom preset is selected
    const selectedCustomPreset = useMemo(() => {
        if (selectedPreset === 'custom') return null;
        const customs = loadCustomPresets();
        return customs.find(p => p.id === selectedPreset) || null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedPreset, customPresetVersion]);

    // Compute effective row indices
    const effectiveRowIndices = useMemo(() => {
        const order = displayOrder || data.map((_, i) => i);
        if (rowRangeMode === 'all') return order;
        const parsedRange = parseRowRange(rowRange, order.length);
        if (parsedRange.length === 0) return order;
        return parsedRange.map(i => order[i]).filter(i => i !== undefined);
    }, [displayOrder, data, rowRange, rowRangeMode]);

    // Load settings on open
    useEffect(() => {
        if (open) {
            const settings = getApifySettings();
            setApiToken(settings.apiToken || '');
            setStep(settings.apiToken ? 'configure' : 'settings');
            setError(null);

            const detected = detectLinkedInColumn(headers, data);
            setDetectedColumn(detected);
            if (detected) {
                setLinkedInColumn(detected);
            }

            // Check for pending results from a previous run
            const pending = apifyProcessingState.pendingResults;
            if (pending && pending.enrichedCount === 0 && pending.items.length > 0) {
                // Restore mapping step from global state
                setMappingItems(pending.items);
                setMappingMeta({
                    actorId: pending.actorId,
                    actorName: pending.actorName,
                    enrichColumnName: pending.enrichColumnName,
                    enrichDisplayName: pending.enrichDisplayName,
                    rowIndices: pending.rowIndices,
                });
                setMappingResultField('');
                setMappingCsvColumn('');
                setMappingPreviewCount(0);
                setStep('mapping');
            } else {
                setSelectedPreset(LINKEDIN_PROFILE_SCRAPER_ID);
                setActorId(LINKEDIN_PROFILE_SCRAPER_ID);
                setShowSavePreset(false);
                setMatchResultField('');
                setMatchCsvColumn('');
            }

            if (initialRowRange) {
                setRowRange(initialRowRange);
                setRowRangeMode('range');
            } else {
                setRowRange('');
                setRowRangeMode('all');
            }
        }
    }, [open, headers, data, initialRowRange]);

    // Update input when LinkedIn column changes
    useEffect(() => {
        if (actorId === LINKEDIN_PROFILE_SCRAPER_ID && linkedInColumn) {
            const rowsToUse = effectiveRowIndices.map(i => data[i]).filter(Boolean);
            const usernames = extractLinkedInUsernames(rowsToUse, linkedInColumn);
            setActorInput(JSON.stringify({ includeEmail: true, usernames }, null, 2));
        } else if (actorId === LINKEDIN_COMPANY_SCRAPER_ID && linkedInColumn) {
            const rowsToUse = effectiveRowIndices.map(i => data[i]).filter(Boolean);
            const companyUrls = extractLinkedInCompanyUrls(rowsToUse, linkedInColumn);
            setActorInput(JSON.stringify({ companies: companyUrls }, null, 2));
        }
    }, [linkedInColumn, actorId, data, effectiveRowIndices]);

    const handlePresetChange = useCallback((value: string) => {
        setSelectedPreset(value);
        setShowSavePreset(false);

        if (value !== 'custom') {
            // Check custom presets first
            const customs = loadCustomPresets();
            const customPreset = customs.find(p => p.id === value);

            if (customPreset) {
                setActorId(customPreset.id);
                setActorInput(customPreset.inputTemplate || '{}');
                setMatchResultField(customPreset.matchResultField || '');
                return;
            }

            // Built-in preset
            const preset = APIFY_PRESETS.find(p => p.id === value);
            if (preset) {
                setActorId(preset.id);
                setMatchResultField('');
                setMatchCsvColumn('');
                if (preset.id === LINKEDIN_PROFILE_SCRAPER_ID && linkedInColumn) {
                    const rowsToUse = effectiveRowIndices.map(i => data[i]).filter(Boolean);
                    const usernames = extractLinkedInUsernames(rowsToUse, linkedInColumn);
                    setActorInput(JSON.stringify({ includeEmail: true, usernames }, null, 2));
                } else if (preset.id === LINKEDIN_COMPANY_SCRAPER_ID && linkedInColumn) {
                    const rowsToUse = effectiveRowIndices.map(i => data[i]).filter(Boolean);
                    const companyUrls = extractLinkedInCompanyUrls(rowsToUse, linkedInColumn);
                    setActorInput(JSON.stringify({ companies: companyUrls }, null, 2));
                } else {
                    setActorInput(JSON.stringify(preset.defaultInput || {}, null, 2));
                }
            }
        } else {
            setActorId('');
            setActorInput('{}');
            setMatchResultField('');
            setMatchCsvColumn('');
        }
    }, [linkedInColumn, data, effectiveRowIndices]);

    const handleSaveToken = useCallback(() => {
        if (!apiToken.trim()) {
            toast.error('Please enter your Apify API token');
            return;
        }
        saveApifySettings({ apiToken: apiToken.trim() });
        toast.success('API token saved');
        setStep('configure');
    }, [apiToken]);

    const handleSavePreset = useCallback(() => {
        if (!presetName.trim() || !actorId.trim()) return;

        const preset: CustomActorPreset = {
            id: actorId.trim(),
            name: presetName.trim(),
            description: presetDescription.trim(),
            inputTemplate: actorInput,
            matchResultField: matchResultField,
            isCustom: true,
        };

        saveCustomPreset(preset);
        setShowSavePreset(false);
        setPresetName('');
        setPresetDescription('');
        setSelectedPreset(actorId.trim());
        setCustomPresetVersion(v => v + 1);
        toast.success(`Preset "${preset.name}" saved`);
    }, [presetName, presetDescription, actorId, actorInput, matchResultField]);

    const handleDeletePreset = useCallback((presetId: string) => {
        deleteCustomPreset(presetId);
        setCustomPresetVersion(v => v + 1);
        setSelectedPreset(LINKEDIN_PROFILE_SCRAPER_ID);
        setActorId(LINKEDIN_PROFILE_SCRAPER_ID);
        toast.success('Preset deleted');
    }, []);

    const handleEditPreset = useCallback(() => {
        if (!selectedCustomPreset) return;
        setPresetName(selectedCustomPreset.name);
        setPresetDescription(selectedCustomPreset.description);
        setShowSavePreset(true);
    }, [selectedCustomPreset]);

    const insertColumnPlaceholder = useCallback((columnName: string) => {
        const placeholder = `{{${columnName}}}`;
        const textarea = textareaRef.current;
        if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const before = actorInput.substring(0, start);
            const after = actorInput.substring(end);
            const newValue = before + placeholder + after;
            setActorInput(newValue);
            setTimeout(() => {
                textarea.focus();
                textarea.selectionStart = textarea.selectionEnd = start + placeholder.length;
            }, 0);
        } else {
            setActorInput(prev => prev + placeholder);
        }
    }, [actorInput]);

    // Expanded JSON preview
    const expandedPreview = useMemo(() => {
        try {
            const placeholders = getTemplatePlaceholders(actorInput);
            if (placeholders.length === 0) return actorInput;
            const previewIndices = effectiveRowIndices.slice(0, 5);
            const expanded = expandTemplate(actorInput, data, previewIndices);
            const suffix = effectiveRowIndices.length > 5
                ? `\n// ... and ${effectiveRowIndices.length - 5} more rows`
                : '';
            return expanded + suffix;
        } catch {
            return 'Invalid JSON template';
        }
    }, [actorInput, data, effectiveRowIndices]);

    const handleRunActor = useCallback(async () => {
        if (!actorId.trim()) {
            toast.error('Please enter an actor ID');
            return;
        }

        const isLinkedIn = actorId === LINKEDIN_PROFILE_SCRAPER_ID || actorId === LINKEDIN_COMPANY_SCRAPER_ID;

        let input: Record<string, unknown> = {};
        if (isLinkedIn) {
            try {
                input = JSON.parse(actorInput);
            } catch {
                toast.error('Invalid JSON input');
                return;
            }
        } else {
            // Expand template placeholders for generic actors
            try {
                const expandedJson = expandTemplate(actorInput, data, effectiveRowIndices);
                input = JSON.parse(expandedJson);
            } catch {
                toast.error('Invalid JSON template');
                return;
            }
        }

        // Get total count for progress tracking
        let totalCount = 0;

        if (actorId === LINKEDIN_PROFILE_SCRAPER_ID) {
            const inputUrls = (input as { usernames?: string[] }).usernames || [];
            if (inputUrls.length === 0) {
                toast.error('No LinkedIn profiles to scrape. Select a column with LinkedIn URLs.');
                return;
            }
            totalCount = inputUrls.length;
        } else if (actorId === LINKEDIN_COMPANY_SCRAPER_ID) {
            const inputUrls = (input as { companies?: string[] }).companies || [];
            if (inputUrls.length === 0) {
                toast.error('No LinkedIn companies to scrape. Select a column with company URLs.');
                return;
            }
            totalCount = inputUrls.length;
        } else {
            totalCount = effectiveRowIndices.length;
        }

        // Get actor name for display
        const preset = APIFY_PRESETS.find(p => p.id === actorId) || selectedCustomPreset;
        const actorName = preset?.name || actorId.split('/').pop() || 'Scraper';

        setIsRunning(true);
        setError(null);
        setStep('running');

        apifyProcessingState.start(actorId, actorName, totalCount);

        try {
            const items = await runApifyActor(actorId, input, (status) => {
                setProgress(status);
                const match = status.match(/(\d+)/);
                if (match) {
                    apifyProcessingState.update(parseInt(match[1], 10));
                }
            });

            // Store enrichment data in per-scraper column
            const enrichColumnName = getEnrichmentColumnName(actorId);
            const enrichDisplayName = getEnrichmentDisplayName(actorId);

            if (!headers.includes(enrichColumnName)) {
                addColumn(enrichColumnName, '');
            }

            let enrichedCount = 0;
            const scrapedAt = new Date().toISOString();

            if (isLinkedIn) {
                // LinkedIn matching — try multiple possible URL field names
                console.log('[Apify] First result item fields:', items[0] ? Object.keys(items[0]) : 'no items');
                if (items[0]) console.log('[Apify] First result sample:', JSON.stringify(items[0]).substring(0, 500));

                for (const item of items) {
                    // Try many possible field names for the URL
                    // originalQuery.search = exact input sent to scraper (most reliable for matching)
                    const origQuery = item.originalQuery as Record<string, unknown> | undefined;
                    const origQueryUrl = origQuery?.search ? String(origQuery.search) : '';
                    const itemUrl = String(
                        origQueryUrl ||
                        item.linkedinUrl || item.linkedInUrl ||
                        item.profileUrl || item.url || item.companyUrl ||
                        item.company_url || item.companyLinkedinUrl ||
                        item.linkedin_url || item.input || ''
                    );
                    const normalizedItemUrl = normalizeUrl(itemUrl);

                    if (!normalizedItemUrl) {
                        console.log('[Apify] Skipping item — no URL found in fields:', Object.keys(item).join(', '));
                        continue;
                    }

                    for (const rowIdx of effectiveRowIndices) {
                        const rowUrl = data[rowIdx]?.[linkedInColumn] || '';
                        const normalizedRowUrl = normalizeUrl(String(rowUrl));

                        if (normalizedRowUrl && normalizedItemUrl &&
                            (normalizedRowUrl.includes(normalizedItemUrl) || normalizedItemUrl.includes(normalizedRowUrl))) {
                            const enrichment: EnrichmentData = {
                                source: actorId,
                                sourceName: actorName,
                                scrapedAt,
                                matchedBy: String(rowUrl),
                                data: item as Record<string, unknown>
                            };
                            updateCell(rowIdx, enrichColumnName, JSON.stringify(enrichment));
                            enrichedCount++;
                            break;
                        }
                    }
                }
            } else {
                // Determine matching fields — use configured values or auto-detect
                let effectiveResultField = matchResultField;
                let effectiveCsvColumn = matchCsvColumn;

                if ((!effectiveResultField || !effectiveCsvColumn) && items.length > 0) {
                    // Auto-detect: find a result field that matches a CSV column name
                    const firstItem = items[0] as Record<string, unknown>;
                    const resultFields = Object.keys(firstItem);
                    const csvHeaders = headers.filter(h => !h.startsWith('__'));
                    const lowerHeaders = csvHeaders.map(h => ({ original: h, lower: h.toLowerCase() }));

                    for (const field of resultFields) {
                        const match = lowerHeaders.find(h => h.lower === field.toLowerCase());
                        if (match) {
                            effectiveResultField = field;
                            effectiveCsvColumn = match.original;
                            toast.info(`Auto-matched results: "${field}" ↔ "${match.original}"`);
                            break;
                        }
                    }

                    if (!effectiveResultField || !effectiveCsvColumn) {
                        toast.warning('Could not auto-detect matching fields. Configure "Match Results to Rows" for better results.');
                    }
                }

                const matches = matchResultsToRows(
                    items as Record<string, unknown>[],
                    data,
                    effectiveRowIndices,
                    effectiveResultField,
                    effectiveCsvColumn
                );

                for (const [rowIdx, item] of matches) {
                    const enrichment: EnrichmentData = {
                        source: actorId,
                        sourceName: actorName,
                        scrapedAt,
                        matchedBy: data[rowIdx]?.[effectiveCsvColumn] || '',
                        data: item
                    };
                    updateCell(rowIdx, enrichColumnName, JSON.stringify(enrichment));
                    enrichedCount++;
                }
            }

            apifyProcessingState.finish();

            if (enrichedCount === 0 && items.length > 0) {
                // No matches — go to mapping step instead of closing
                setMappingItems(items as Record<string, unknown>[]);
                setMappingMeta({
                    actorId,
                    actorName,
                    enrichColumnName,
                    enrichDisplayName,
                    rowIndices: [...effectiveRowIndices],
                });
                setMappingResultField('');
                setMappingCsvColumn('');
                setMappingPreviewCount(0);
                setStep('mapping');

                // Also store globally so it survives dialog close
                apifyProcessingState.storePendingResults({
                    items: items as Record<string, unknown>[],
                    actorId,
                    actorName,
                    enrichColumnName,
                    enrichDisplayName,
                    rowIndices: [...effectiveRowIndices],
                    enrichedCount: 0,
                });

                toast.warning(`Got ${items.length} results but matched 0 rows. Map the fields below.`);
            } else {
                apifyProcessingState.clearPendingResults();
                toast.success(`Created "${enrichDisplayName}" column with ${enrichedCount} rows enriched. Click any cell in that column to add fields.`);
                onOpenChange(false);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
            toast.error(message);
            apifyProcessingState.finish();
            setStep('configure');
        } finally {
            setIsRunning(false);
        }
    }, [actorId, actorInput, headers, data, effectiveRowIndices, linkedInColumn, matchResultField, matchCsvColumn, selectedCustomPreset, addColumn, updateCell, onOpenChange]);

    const isLinkedInScraper = actorId === LINKEDIN_PROFILE_SCRAPER_ID;
    const isCompanyScraper = actorId === LINKEDIN_COMPANY_SCRAPER_ID;
    const isLinkedInActor = isLinkedInScraper || isCompanyScraper;

    // Count of URLs to scrape (skip rows already enriched by THIS scraper)
    const unenrichedRows = effectiveRowIndices.filter(i => !hasEnrichmentFromSource(data[i] || {}, actorId));
    const profileCount = isLinkedInScraper && linkedInColumn
        ? extractLinkedInUsernames(unenrichedRows.map(i => data[i]).filter(Boolean), linkedInColumn).length
        : 0;
    const companyCount = isCompanyScraper && linkedInColumn
        ? extractLinkedInCompanyUrls(unenrichedRows.map(i => data[i]).filter(Boolean), linkedInColumn).length
        : 0;

    // Custom presets for the dropdown
    const customPresets = useMemo(() => loadCustomPresets(), [customPresetVersion]);

    // Check if template has placeholders
    const hasPlaceholders = !isLinkedInActor && getTemplatePlaceholders(actorInput).length > 0;

    // Visible CSV columns (exclude hidden enrichment columns)
    const visibleHeaders = headers.filter(h => !h.startsWith('__'));

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Database className="w-5 h-5 text-orange-500" />
                        Run Apify Scraper
                    </DialogTitle>
                    <DialogDescription>
                        {step === 'settings' && 'Configure your Apify API token'}
                        {step === 'configure' && 'Select and configure an actor to run'}
                        {step === 'running' && 'Scraping data...'}
                    </DialogDescription>
                </DialogHeader>

                {/* Step indicator */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                    <span className={step === 'settings' ? 'text-primary font-medium' : ''}>Settings</span>
                    <ChevronRight className="w-3 h-3" />
                    <span className={step === 'configure' ? 'text-primary font-medium' : ''}>Configure</span>
                    <ChevronRight className="w-3 h-3" />
                    <span className={step === 'running' ? 'text-primary font-medium' : ''}>Run</span>
                    {(step === 'mapping' || mappingItems.length > 0) && <><ChevronRight className="w-3 h-3" /><span className={step === 'mapping' ? 'text-primary font-medium' : ''}>Map Results</span></>}
                </div>

                {error && (
                    <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg mb-4">
                        <AlertCircle className="w-4 h-4" />
                        <span className="text-sm">{error}</span>
                    </div>
                )}

                {/* Settings Step */}
                {step === 'settings' && (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Apify API Token</Label>
                            <div className="flex gap-2">
                                <Input type={showToken ? 'text' : 'password'} value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder="apify_api_..." className="flex-1" />
                                <Button variant="outline" size="sm" onClick={() => setShowToken(!showToken)}>{showToken ? 'Hide' : 'Show'}</Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Get your token from <a href="https://console.apify.com/settings/integrations" target="_blank" rel="noreferrer" className="text-primary underline">Apify Console</a>
                            </p>
                        </div>
                        <DialogFooter>
                            <Button onClick={handleSaveToken}><Settings className="w-4 h-4 mr-2" />Save & Continue</Button>
                        </DialogFooter>
                    </div>
                )}

                {/* Configure Step */}
                {step === 'configure' && (
                    <div className="space-y-4">
                        {/* Actor Selector */}
                        <div className="space-y-2">
                            <Label>Select Actor</Label>
                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <Select value={selectedPreset} onValueChange={handlePresetChange}>
                                        <SelectTrigger><SelectValue placeholder="Choose a preset or custom" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="custom">Custom Actor ID</SelectItem>
                                            {APIFY_PRESETS.map(preset => (
                                                <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>
                                            ))}
                                            {customPresets.length > 0 && customPresets.map(preset => (
                                                <SelectItem key={preset.id} value={preset.id}>⭐ {preset.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                {selectedCustomPreset && (
                                    <div className="flex gap-1">
                                        <Button variant="outline" size="icon" className="h-9 w-9" onClick={handleEditPreset} title="Edit preset">
                                            <Pencil className="w-3.5 h-3.5" />
                                        </Button>
                                        <Button variant="outline" size="icon" className="h-9 w-9 text-destructive hover:text-destructive" onClick={() => handleDeletePreset(selectedPreset)} title="Delete preset">
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Row Range Selection */}
                        <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
                            <Label>Rows to Process</Label>
                            <div className="flex items-center gap-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="radio" name="rowRangeMode" checked={rowRangeMode === 'all'} onChange={() => setRowRangeMode('all')} className="w-4 h-4" />
                                    <span className="text-sm">All Rows ({data.length})</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="radio" name="rowRangeMode" checked={rowRangeMode === 'range'} onChange={() => setRowRangeMode('range')} className="w-4 h-4" />
                                    <span className="text-sm">Specific Rows</span>
                                </label>
                            </div>
                            {rowRangeMode === 'range' && (
                                <div className="mt-2">
                                    <Input value={rowRange} onChange={(e) => setRowRange(e.target.value)} placeholder="e.g., 1-10, 15, 20-25" className="font-mono text-sm" />
                                    <p className="text-xs text-muted-foreground mt-1">{effectiveRowIndices.length} rows selected</p>
                                </div>
                            )}
                        </div>

                        {/* LinkedIn-specific */}
                        {isLinkedInActor && (
                            <div className="space-y-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                                <Label className="flex items-center gap-2">
                                    <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" /></svg>
                                    {isLinkedInScraper ? 'Select CSV Column with LinkedIn Profile URLs' : 'Select CSV Column with LinkedIn Company URLs'}
                                </Label>
                                <Select value={linkedInColumn} onValueChange={setLinkedInColumn}>
                                    <SelectTrigger><SelectValue placeholder="Select column..." /></SelectTrigger>
                                    <SelectContent>{headers.map(h => (<SelectItem key={h} value={h}>{h} {h === detectedColumn && '(auto-detected)'}</SelectItem>))}</SelectContent>
                                </Select>
                                {isLinkedInScraper && profileCount > 0 && (
                                    <p className="text-sm text-blue-600">✓ Found <strong>{profileCount}</strong> LinkedIn profiles to scrape {profileCount > 500 && <span className="text-destructive">(max 500)</span>}</p>
                                )}
                                {isCompanyScraper && companyCount > 0 && (
                                    <p className="text-sm text-blue-600">✓ Found <strong>{companyCount}</strong> LinkedIn companies to scrape</p>
                                )}
                            </div>
                        )}

                        {/* Actor ID */}
                        <div className="space-y-2">
                            <Label>Actor ID</Label>
                            <Input value={actorId} onChange={(e) => setActorId(e.target.value)} placeholder="username/actor-name" />
                        </div>

                        {/* JSON Input */}
                        <div className="space-y-2">
                            <Label>
                                Input (JSON)
                                {!isLinkedInActor && <span className="text-xs text-muted-foreground ml-1">— click columns below to insert</span>}
                            </Label>
                            <textarea
                                ref={textareaRef}
                                value={actorInput}
                                onChange={(e) => setActorInput(e.target.value)}
                                className="w-full h-32 p-2 text-sm font-mono border rounded-md bg-background"
                                placeholder='{"startUrls": [{"url": "https://..."}]}'
                            />

                            {/* Column Chips */}
                            {!isLinkedInActor && visibleHeaders.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {visibleHeaders.map(h => (
                                        <button
                                            key={h}
                                            onClick={() => insertColumnPlaceholder(h)}
                                            className="px-2 py-0.5 text-xs rounded-full border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900 transition-colors cursor-pointer"
                                        >
                                            {`{{${h}}}`}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Match Config — for non-LinkedIn actors */}
                        {!isLinkedInActor && (
                            <div className="space-y-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                                <Label className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                                    🔗 Match Results to Rows
                                </Label>
                                <p className="text-xs text-muted-foreground">How should each result be matched back to the correct CSV row?</p>
                                <div className="grid grid-cols-2 gap-3 mt-2">
                                    <div className="space-y-1">
                                        <Label className="text-xs">Result field name</Label>
                                        <Input
                                            value={matchResultField}
                                            onChange={(e) => setMatchResultField(e.target.value)}
                                            placeholder="e.g., profileUrl, username"
                                            className="text-sm"
                                            list="common-result-fields"
                                        />
                                        <datalist id="common-result-fields">
                                            <option value="url" />
                                            <option value="profileUrl" />
                                            <option value="linkedInUrl" />
                                            <option value="username" />
                                            <option value="email" />
                                            <option value="companyUrl" />
                                            <option value="name" />
                                            <option value="handle" />
                                        </datalist>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">CSV column</Label>
                                        <Select value={matchCsvColumn} onValueChange={setMatchCsvColumn}>
                                            <SelectTrigger className="text-sm"><SelectValue placeholder="Select column..." /></SelectTrigger>
                                            <SelectContent>
                                                {visibleHeaders.map(h => (
                                                    <SelectItem key={h} value={h}>{h}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* JSON Preview */}
                        {hasPlaceholders && (
                            <div className="space-y-2">
                                <button onClick={() => setShowPreview(!showPreview)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                                    {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                    {showPreview ? 'Hide' : 'Show'} expanded preview ({effectiveRowIndices.length} rows)
                                </button>
                                {showPreview && (
                                    <pre className="p-2 text-xs font-mono bg-muted rounded-md max-h-40 overflow-auto whitespace-pre-wrap">
                                        {expandedPreview}
                                    </pre>
                                )}
                            </div>
                        )}

                        {/* Save as Preset Form */}
                        {showSavePreset && (
                            <div className="p-3 border rounded-lg space-y-3 bg-muted/50">
                                <Label className="font-medium">{selectedCustomPreset ? 'Update Preset' : 'Save as Custom Preset'}</Label>
                                <div className="space-y-2">
                                    <Input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Preset name (e.g., Twitter Scraper)" />
                                    <Input value={presetDescription} onChange={(e) => setPresetDescription(e.target.value)} placeholder="Brief description" />
                                </div>
                                <div className="flex gap-2 justify-end">
                                    <Button variant="outline" size="sm" onClick={() => setShowSavePreset(false)}>Cancel</Button>
                                    <Button size="sm" onClick={handleSavePreset} disabled={!presetName.trim() || !actorId.trim()}>
                                        <Save className="w-3.5 h-3.5 mr-1" />{selectedCustomPreset ? 'Update' : 'Save'}
                                    </Button>
                                </div>
                            </div>
                        )}

                        <DialogFooter className="flex justify-between">
                            <div className="flex gap-2">
                                <Button variant="outline" onClick={() => setStep('settings')}>Change Token</Button>
                                {!isLinkedInActor && !showSavePreset && (
                                    <Button variant="outline" onClick={() => {
                                        if (selectedCustomPreset) {
                                            handleEditPreset();
                                        } else {
                                            setShowSavePreset(true);
                                            setPresetName('');
                                            setPresetDescription('');
                                        }
                                    }}>
                                        <Save className="w-4 h-4 mr-2" />
                                        {selectedCustomPreset ? 'Update Preset' : 'Save as Preset'}
                                    </Button>
                                )}
                            </div>
                            <Button onClick={handleRunActor} disabled={!actorId.trim() || (isLinkedInScraper && profileCount === 0) || (isCompanyScraper && companyCount === 0)}>
                                <Play className="w-4 h-4 mr-2" />
                                {isLinkedInScraper ? `Scrape ${Math.min(profileCount, 500)} Profiles` : isCompanyScraper ? `Scrape ${companyCount} Companies` : 'Run Actor'}
                            </Button>
                        </DialogFooter>
                    </div>
                )}

                {/* Running Step */}
                {step === 'running' && (
                    <div className="flex flex-col items-center justify-center py-8 space-y-6">
                        <Loader2 className="w-12 h-12 animate-spin text-primary" />
                        <div className="w-full max-w-md space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-medium">{progress || 'Starting...'}</span>
                                {apifyProcessingState.totalCount > 0 && (
                                    <span className="text-muted-foreground">
                                        {apifyProcessingState.processedCount}/{apifyProcessingState.totalCount}
                                    </span>
                                )}
                            </div>
                            {apifyProcessingState.totalCount > 0 && (
                                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-primary transition-all duration-300"
                                        style={{ width: `${Math.round((apifyProcessingState.processedCount / apifyProcessingState.totalCount) * 100)}%` }}
                                    />
                                </div>
                            )}
                            <p className="text-xs text-muted-foreground text-center">
                                {apifyProcessingState.failedIds.size > 0 && (
                                    <span className="text-destructive mr-2">{apifyProcessingState.failedIds.size} failed</span>
                                )}
                                This may take a few minutes
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            onClick={() => {
                                apifyProcessingState.cancel();
                                setIsRunning(false);
                                setStep('configure');
                                toast.info('Scrape cancelled');
                            }}
                        >
                            Cancel
                        </Button>
                    </div>
                )}

                {/* Mapping Step */}
                {step === 'mapping' && mappingMeta && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                            <div>
                                <p className="text-sm font-medium">Got {mappingItems.length} results but matched 0 rows</p>
                                <p className="text-xs text-muted-foreground">Select which result field matches your CSV column to map them</p>
                            </div>
                        </div>

                        {/* Result fields from actual data */}
                        <div className="space-y-2">
                            <Label>Result field (from scraped data)</Label>
                            <div className="flex flex-wrap gap-1.5">
                                {mappingItems.length > 0 && Object.keys(mappingItems[0]).map(field => (
                                    <button
                                        key={field}
                                        onClick={() => { setMappingResultField(field); setMappingPreviewCount(0); }}
                                        className={`px-2.5 py-1 text-xs rounded-full border transition-colors cursor-pointer ${mappingResultField === field
                                            ? 'border-primary bg-primary text-primary-foreground'
                                            : 'border-muted-foreground/30 hover:border-primary/50'
                                            }`}
                                    >
                                        {field}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* CSV column selector */}
                        <div className="space-y-2">
                            <Label>CSV column to match against</Label>
                            <Select value={mappingCsvColumn} onValueChange={(v) => { setMappingCsvColumn(v); setMappingPreviewCount(0); }}>
                                <SelectTrigger><SelectValue placeholder="Select CSV column..." /></SelectTrigger>
                                <SelectContent>
                                    {headers.filter(h => !h.startsWith('__')).map(h => (
                                        <SelectItem key={h} value={h}>{h}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Live preview of matches */}
                        {mappingResultField && mappingCsvColumn && (
                            <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
                                <Label className="text-xs">Preview (first 3 results)</Label>
                                {mappingItems.slice(0, 3).map((item, idx) => {
                                    const resultVal = String(item[mappingResultField] || '');
                                    const matchRow = data.findIndex(row => {
                                        const csvVal = row[mappingCsvColumn] || '';
                                        const nR = resultVal.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
                                        const nC = csvVal.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
                                        return nR && nC && (nR.includes(nC) || nC.includes(nR));
                                    });
                                    return (
                                        <div key={idx} className="flex items-center gap-2 text-xs font-mono">
                                            <span className="truncate max-w-[200px]">{resultVal || '(empty)'}</span>
                                            <span className="text-muted-foreground">→</span>
                                            {matchRow >= 0
                                                ? <span className="text-green-600 flex items-center gap-1"><Check className="w-3 h-3" /> Row {matchRow + 1}</span>
                                                : <span className="text-destructive">No match</span>
                                            }
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <DialogFooter className="flex justify-between">
                            <Button variant="outline" onClick={() => {
                                apifyProcessingState.clearPendingResults();
                                setMappingItems([]);
                                setMappingMeta(null);
                                onOpenChange(false);
                            }}>
                                Skip & Close
                            </Button>
                            <Button
                                onClick={() => {
                                    if (!mappingResultField || !mappingCsvColumn || !mappingMeta) return;

                                    const matches = matchResultsToRows(
                                        mappingItems,
                                        data,
                                        mappingMeta.rowIndices,
                                        mappingResultField,
                                        mappingCsvColumn
                                    );

                                    if (!headers.includes(mappingMeta.enrichColumnName)) {
                                        addColumn(mappingMeta.enrichColumnName, '');
                                    }

                                    let count = 0;
                                    const scrapedAt = new Date().toISOString();
                                    for (const [rowIdx, item] of matches) {
                                        const enrichment: EnrichmentData = {
                                            source: mappingMeta.actorId,
                                            sourceName: mappingMeta.actorName,
                                            scrapedAt,
                                            matchedBy: data[rowIdx]?.[mappingCsvColumn] || '',
                                            data: item
                                        };
                                        updateCell(rowIdx, mappingMeta.enrichColumnName, JSON.stringify(enrichment));
                                        count++;
                                    }

                                    setMappingPreviewCount(count);

                                    if (count > 0) {
                                        apifyProcessingState.clearPendingResults();
                                        toast.success(`Mapped ${count} rows! Column "${mappingMeta.enrichDisplayName}" updated.`);
                                        setMappingItems([]);
                                        setMappingMeta(null);
                                        onOpenChange(false);
                                    } else {
                                        toast.error('Still 0 matches. Try a different field/column combination.');
                                    }
                                }}
                                disabled={!mappingResultField || !mappingCsvColumn}
                            >
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Re-match ({mappingItems.length} results)
                            </Button>
                        </DialogFooter>
                    </div>
                )}

            </DialogContent>
        </Dialog>
    );
}
