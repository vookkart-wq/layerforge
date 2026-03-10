import { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Loader2, CheckCircle2, AlertCircle, Plus, Upload, ArrowLeft, ArrowRight, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCSVStore } from '@/stores/useCSVStore';
import {
    getSuccessAiSettings,
    saveSuccessAiSettings,
    clearSuccessAiValidation,
    authenticate,
    listCampaigns,
    createCampaign,
    pushContactsInBatches,
    mapRowToContact,
    SUCCESSAI_FIELDS,
    SuccessAiCampaign,
    SuccessAiContact,
    getCachedCampaigns,
    saveCampaignsToCache,
    clearCampaignCache
} from '@/services/successAiService';

interface SuccessAiDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    displayOrder: number[];
    initialRowRange?: string;
}

type Step = 'api-key' | 'campaign' | 'mapping' | 'range' | 'push';

export function SuccessAiDialog({ open, onOpenChange, displayOrder, initialRowRange }: SuccessAiDialogProps) {
    const { data, headers } = useCSVStore();

    // State
    const [step, setStep] = useState<Step>('api-key');
    const [apiKey, setApiKey] = useState('');
    const [isValidating, setIsValidating] = useState(false);
    const [isKeyValid, setIsKeyValid] = useState(false);
    const [workspaceName, setWorkspaceName] = useState('');

    const [campaigns, setCampaigns] = useState<SuccessAiCampaign[]>([]);
    const [loadingCampaigns, setLoadingCampaigns] = useState(false);
    const [selectedCampaign, setSelectedCampaign] = useState<string>('');
    const [createNewCampaign, setCreateNewCampaign] = useState(false);
    const [newCampaignName, setNewCampaignName] = useState('');
    const [creatingCampaign, setCreatingCampaign] = useState(false);

    const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
    const [customFields, setCustomFields] = useState<string[]>([]);

    const [rangeStart, setRangeStart] = useState(1);
    const [rangeEnd, setRangeEnd] = useState(data.length || 1);

    const [isPushing, setIsPushing] = useState(false);
    const [pushProgress, setPushProgress] = useState(0);
    const [pushResult, setPushResult] = useState<{ confirmed: number; possibly: number; errors: string[] } | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Load saved settings on open
    useEffect(() => {
        if (open) {
            const settings = getSuccessAiSettings();
            if (settings.apiKey) {
                setApiKey(settings.apiKey);

                // If already validated, skip API call and use cached data
                if (settings.isValidated) {
                    setIsKeyValid(true);
                    setWorkspaceName(settings.workspaceName);

                    // Load cached campaigns if available
                    const cached = getCachedCampaigns();
                    if (cached && Array.isArray(cached.campaigns) && cached.campaigns.length > 0) {
                        setCampaigns(cached.campaigns);
                    }
                } else {
                    // Only validate if not already validated
                    validateApiKey(settings.apiKey);
                }
            }
            setRangeEnd(data.length || 1);

            // Auto-detect email column
            const emailCol = headers.find(h => h.toLowerCase().includes('email'));
            if (emailCol) {
                setFieldMapping(prev => ({ ...prev, email: emailCol }));
            }
        }
    }, [open, data.length, headers]);

    const validateApiKey = useCallback(async (key: string) => {
        if (!key.trim()) return;

        setIsValidating(true);
        const result = await authenticate(key);
        setIsValidating(false);

        if (result.valid) {
            setIsKeyValid(true);
            setWorkspaceName(result.workspaceName || '');
            saveSuccessAiSettings(key, result.workspaceName);
            toast.success('API key validated!');
        } else {
            setIsKeyValid(false);
            clearSuccessAiValidation();
            toast.error(result.error || 'Invalid API key');
        }
    }, []);

    const loadCampaigns = useCallback(async (forceRefresh = false) => {
        if (!apiKey) return;

        // Use cache if available and not forcing refresh
        if (!forceRefresh) {
            const cached = getCachedCampaigns();
            if (cached && !cached.expired && Array.isArray(cached.campaigns)) {
                setCampaigns(cached.campaigns);
                return;
            }
        }

        setLoadingCampaigns(true);
        const result = await listCampaigns(apiKey);
        setLoadingCampaigns(false);

        if (result.error) {
            toast.error(result.error);
        } else {
            setCampaigns(result.campaigns);
            saveCampaignsToCache(result.campaigns);
        }
    }, [apiKey]);

    const handleCreateCampaign = async () => {
        if (!newCampaignName.trim()) {
            toast.error('Please enter a campaign name');
            return;
        }

        setCreatingCampaign(true);
        const result = await createCampaign(apiKey, newCampaignName.trim());
        setCreatingCampaign(false);

        if (result.error) {
            toast.error(result.error);
        } else if (result.campaignId) {
            toast.success('Campaign created!');
            setSelectedCampaign(result.campaignId);
            setCreateNewCampaign(false);
            setNewCampaignName('');
            // Auto-advance to the next step (mapping)
            setStep('mapping');
        }
    };

    const handlePush = async () => {
        if (!selectedCampaign) {
            toast.error('Please select a campaign');
            return;
        }

        if (!fieldMapping.email) {
            toast.error('Please map the email field');
            return;
        }

        // Prepare contacts
        const contacts: SuccessAiContact[] = [];
        const start = Math.max(0, rangeStart - 1);
        const end = Math.min(data.length, rangeEnd);

        for (let i = start; i < end; i++) {
            const rowIndex = displayOrder[i];
            const row = data[rowIndex];
            if (!row) continue;

            const contact = mapRowToContact(row, fieldMapping, customFields);
            if (contact) {
                contacts.push(contact);
            }
        }

        if (contacts.length === 0) {
            toast.error('No valid contacts to push (all rows missing email)');
            return;
        }

        // Create abort controller for cancel functionality
        abortControllerRef.current = new AbortController();

        setIsPushing(true);
        setPushProgress(0);
        setPushResult(null);

        const result = await pushContactsInBatches(
            apiKey,
            selectedCampaign,
            contacts,
            (uploaded, total) => {
                setPushProgress(Math.round((uploaded / total) * 100));
            },
            abortControllerRef.current.signal
        );

        abortControllerRef.current = null;
        setIsPushing(false);
        setPushResult({
            confirmed: result.confirmedUploaded,
            possibly: result.possiblyUploaded,
            errors: result.errors
        });

        const totalMaybeUploaded = result.confirmedUploaded + result.possiblyUploaded;

        if (result.errors.some(e => e.includes('Cancelled'))) {
            toast.info(`Push cancelled. ${result.confirmedUploaded} contacts confirmed uploaded.`);
        } else if (result.errors.length === 0) {
            toast.success(`Successfully pushed ${result.confirmedUploaded} contacts!`);
        } else if (result.possiblyUploaded > 0) {
            toast.warning(`${result.confirmedUploaded} confirmed + up to ${result.possiblyUploaded} possibly uploaded (check Success.ai to verify)`);
        } else {
            toast.warning(`Pushed ${result.confirmedUploaded} contacts with ${result.errors.length} errors`);
        }
    };

    const handleCancelPush = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            toast.info('Cancelling push...');
        }
    };

    const goToStep = (newStep: Step) => {
        if (newStep === 'campaign' && isKeyValid) {
            loadCampaigns();
        }
        setStep(newStep);
    };

    const resetDialog = () => {
        setStep('api-key');
        setSelectedCampaign('');
        setCreateNewCampaign(false);
        setNewCampaignName('');
        setPushResult(null);
        setPushProgress(0);
    };

    const handleClose = () => {
        resetDialog();
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Upload className="w-5 h-5 text-blue-500" />
                        Push to Success.ai
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Step indicator */}
                    <div className="flex justify-center gap-2 mb-4">
                        {(['api-key', 'campaign', 'mapping', 'range', 'push'] as Step[]).map((s, i) => (
                            <div
                                key={s}
                                className={`w-2 h-2 rounded-full ${step === s ? 'bg-blue-500' : 'bg-gray-300'}`}
                            />
                        ))}
                    </div>

                    {/* Step 1: API Key */}
                    {step === 'api-key' && (
                        <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                Enter your Success.ai API key to connect.
                            </p>

                            <div className="space-y-2">
                                <Label>API Key</Label>
                                <div className="flex gap-2">
                                    <Input
                                        type="password"
                                        value={apiKey}
                                        onChange={(e) => {
                                            setApiKey(e.target.value);
                                            setIsKeyValid(false);
                                        }}
                                        placeholder="Enter your Success.ai API key"
                                        className="flex-1"
                                    />
                                    <Button
                                        onClick={() => validateApiKey(apiKey)}
                                        disabled={isValidating || !apiKey.trim()}
                                        variant="outline"
                                    >
                                        {isValidating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Validate'}
                                    </Button>
                                </div>

                                {isKeyValid && (
                                    <div className="flex items-center gap-2 text-green-600 text-sm">
                                        <CheckCircle2 className="w-4 h-4" />
                                        Connected to: {workspaceName || 'Success.ai'}
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-end">
                                <Button
                                    onClick={() => goToStep('campaign')}
                                    disabled={!isKeyValid}
                                >
                                    Next <ArrowRight className="w-4 h-4 ml-1" />
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Campaign Selection */}
                    {step === 'campaign' && (
                        <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                Choose an existing campaign or create a new one.
                            </p>

                            {loadingCampaigns ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="w-6 h-6 animate-spin" />
                                </div>
                            ) : (
                                <>
                                    {!createNewCampaign ? (
                                        <div className="space-y-3">
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <Label>Select Campaign {campaigns.length > 0 && <span className="text-muted-foreground font-normal">({campaigns.length} found)</span>}</Label>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => loadCampaigns(true)}
                                                        disabled={loadingCampaigns}
                                                        className="h-7 px-2"
                                                        title="Refresh campaigns"
                                                    >
                                                        <RefreshCw className={`w-4 h-4 ${loadingCampaigns ? 'animate-spin' : ''}`} />
                                                    </Button>
                                                </div>
                                                {campaigns.length === 0 ? (
                                                    <p className="text-sm text-muted-foreground py-2">No campaigns found. Create a new one below.</p>
                                                ) : (
                                                    <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Choose a campaign..." />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {campaigns.map((c) => (
                                                                <SelectItem key={c.campaignId} value={c.campaignId}>
                                                                    {c.campaignName}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                )}
                                            </div>

                                            <div className="text-center text-sm text-muted-foreground">or</div>

                                            <Button
                                                variant="outline"
                                                className="w-full"
                                                onClick={() => setCreateNewCampaign(true)}
                                            >
                                                <Plus className="w-4 h-4 mr-2" />
                                                Create New Campaign
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <div className="space-y-2">
                                                <Label>New Campaign Name</Label>
                                                <Input
                                                    value={newCampaignName}
                                                    onChange={(e) => setNewCampaignName(e.target.value)}
                                                    placeholder="Enter campaign name"
                                                />
                                            </div>

                                            <div className="flex gap-2">
                                                <Button
                                                    variant="outline"
                                                    onClick={() => setCreateNewCampaign(false)}
                                                    className="flex-1"
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    onClick={handleCreateCampaign}
                                                    disabled={creatingCampaign || !newCampaignName.trim()}
                                                    className="flex-1"
                                                >
                                                    {creatingCampaign ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            <div className="flex justify-between">
                                <Button variant="ghost" onClick={() => goToStep('api-key')}>
                                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                                </Button>
                                <Button
                                    onClick={() => goToStep('mapping')}
                                    disabled={!selectedCampaign}
                                >
                                    Next <ArrowRight className="w-4 h-4 ml-1" />
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Field Mapping */}
                    {step === 'mapping' && (
                        <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                Map your CSV columns to Success.ai fields.
                            </p>

                            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                                <div className="space-y-3">
                                    <h4 className="font-medium text-sm">Standard Fields</h4>
                                    {SUCCESSAI_FIELDS.map((field) => (
                                        <div key={field.key} className="flex items-center gap-2">
                                            <Label className="w-28 text-sm">
                                                {field.label}
                                                {field.required && <span className="text-red-500">*</span>}
                                            </Label>
                                            <Select
                                                value={fieldMapping[field.key] || 'none'}
                                                onValueChange={(val) => {
                                                    setFieldMapping(prev => ({ ...prev, [field.key]: val === 'none' ? '' : val }));
                                                    // Remove from custom fields if selected there
                                                    if (val !== 'none' && customFields.includes(val)) {
                                                        setCustomFields(prev => prev.filter(f => f !== val));
                                                    }
                                                }}
                                            >
                                                <SelectTrigger className="flex-1">
                                                    <SelectValue placeholder="Select column..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">-- None --</SelectItem>
                                                    {headers.map((h) => (
                                                        <SelectItem key={h} value={h}>{h}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ))}
                                </div>

                                <div className="pt-4 border-t">
                                    <h4 className="font-medium text-sm mb-2">Custom Variables</h4>
                                    <p className="text-xs text-muted-foreground mb-3">
                                        Select additional columns to push as custom variables.
                                    </p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {headers.filter(h => !Object.values(fieldMapping).includes(h)).map((h) => (
                                            <div key={h} className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    id={`custom-${h}`}
                                                    checked={customFields.includes(h)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setCustomFields(prev => [...prev, h]);
                                                        } else {
                                                            setCustomFields(prev => prev.filter(f => f !== h));
                                                        }
                                                    }}
                                                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                />
                                                <Label htmlFor={`custom-${h}`} className="text-sm truncate cursor-pointer" title={h}>
                                                    {h}
                                                </Label>
                                            </div>
                                        ))}
                                    </div>
                                    {headers.every(h => Object.values(fieldMapping).includes(h)) && (
                                        <p className="text-sm text-muted-foreground italic">
                                            All columns are mapped to standard fields.
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="flex justify-between">
                                <Button variant="ghost" onClick={() => goToStep('campaign')}>
                                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                                </Button>
                                <Button
                                    onClick={() => goToStep('range')}
                                    disabled={!fieldMapping.email}
                                >
                                    Next <ArrowRight className="w-4 h-4 ml-1" />
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Step 4: Row Range */}
                    {step === 'range' && (
                        <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                Select which rows to push ({data.length} rows available).
                            </p>

                            <div className="flex items-center gap-4">
                                <div className="space-y-2 flex-1">
                                    <Label>From Row</Label>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={data.length}
                                        value={rangeStart}
                                        onChange={(e) => setRangeStart(Math.max(1, parseInt(e.target.value) || 1))}
                                    />
                                </div>
                                <div className="space-y-2 flex-1">
                                    <Label>To Row</Label>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={data.length}
                                        value={rangeEnd}
                                        onChange={(e) => setRangeEnd(Math.min(data.length, parseInt(e.target.value) || data.length))}
                                    />
                                </div>
                            </div>

                            <div className="text-sm text-muted-foreground text-center">
                                Will push {Math.max(0, rangeEnd - rangeStart + 1)} contacts
                            </div>

                            <div className="flex justify-between">
                                <Button variant="ghost" onClick={() => goToStep('mapping')}>
                                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                                </Button>
                                <Button onClick={() => goToStep('push')}>
                                    Next <ArrowRight className="w-4 h-4 ml-1" />
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Step 5: Push */}
                    {step === 'push' && (
                        <div className="space-y-4">
                            {!pushResult ? (
                                <>
                                    <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                                        <p className="text-sm"><strong>Campaign:</strong> {campaigns.find(c => c.campaignId === selectedCampaign)?.campaignName}</p>
                                        <p className="text-sm"><strong>Rows:</strong> {rangeStart} - {rangeEnd} ({rangeEnd - rangeStart + 1} contacts)</p>
                                        <p className="text-sm"><strong>Email Column:</strong> {fieldMapping.email}</p>
                                    </div>

                                    {isPushing && (
                                        <div className="space-y-2">
                                            <Progress value={pushProgress} />
                                            <p className="text-sm text-center text-muted-foreground">
                                                Pushing contacts... {pushProgress}%
                                            </p>
                                            <div className="flex justify-center">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleCancelPush}
                                                    className="text-red-500 border-red-500/50 hover:bg-red-500/10"
                                                >
                                                    <X className="w-4 h-4 mr-1" /> Cancel Push
                                                </Button>
                                            </div>
                                        </div>
                                    )}



                                    <div className="flex justify-between">
                                        <Button variant="ghost" onClick={() => goToStep('range')} disabled={isPushing}>
                                            <ArrowLeft className="w-4 h-4 mr-1" /> Back
                                        </Button>
                                        <Button
                                            onClick={handlePush}
                                            disabled={isPushing}
                                            className="bg-blue-600 hover:bg-blue-700"
                                        >
                                            {isPushing ? (
                                                <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Pushing...</>
                                            ) : (
                                                <><Upload className="w-4 h-4 mr-2" /> Push to Success.ai</>
                                            )}
                                        </Button>
                                    </div>
                                </>
                            ) : (
                                <div className="space-y-4">
                                    {/* Success banner or partial success */}
                                    {pushResult.confirmed > 0 || pushResult.possibly > 0 ? (
                                        <div className={`flex items-center gap-3 p-4 rounded-lg ${pushResult.possibly > 0
                                            ? 'bg-yellow-500/10 border border-yellow-500/30'
                                            : 'bg-green-500/10 border border-green-500/30'
                                            }`}>
                                            <CheckCircle2 className={`w-6 h-6 ${pushResult.possibly > 0 ? 'text-yellow-500' : 'text-green-500'}`} />
                                            <div>
                                                <p className="font-medium">
                                                    {pushResult.possibly > 0 ? 'Push Complete (with server errors)' : 'Push Complete!'}
                                                </p>
                                                <p className="text-sm text-muted-foreground">
                                                    {pushResult.confirmed > 0 && (
                                                        <><strong>{pushResult.confirmed}</strong> contacts confirmed uploaded</>
                                                    )}
                                                    {pushResult.confirmed > 0 && pushResult.possibly > 0 && <br />}
                                                    {pushResult.possibly > 0 && (
                                                        <><strong>~{pushResult.possibly}</strong> may have uploaded despite errors</>
                                                    )}
                                                </p>
                                                {pushResult.possibly > 0 && (
                                                    <p className="text-xs text-yellow-600 mt-1">
                                                        ⚠️ Please check Success.ai to verify the actual count
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                                            <AlertCircle className="w-6 h-6 text-red-500" />
                                            <div>
                                                <p className="font-medium">Push Failed</p>
                                                <p className="text-sm text-muted-foreground">
                                                    No contacts were uploaded
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    {pushResult.errors.length > 0 && (
                                        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                                            <div className="flex items-center gap-2 mb-2">
                                                <AlertCircle className="w-4 h-4 text-yellow-500" />
                                                <span className="font-medium">Details ({pushResult.errors.length} issues)</span>
                                            </div>
                                            <ul className="text-sm text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
                                                {pushResult.errors.slice(0, 5).map((e, i) => (
                                                    <li key={i}>• {e}</li>
                                                ))}
                                                {pushResult.errors.length > 5 && (
                                                    <li className="text-xs italic">...and {pushResult.errors.length - 5} more</li>
                                                )}
                                            </ul>
                                        </div>
                                    )}

                                    <Button onClick={handleClose} className="w-full">
                                        Done
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
