import { useState, useCallback, useEffect, useMemo } from 'react';
import { Play, Settings, AlertCircle, Loader2, ChevronRight, Mail, RefreshCw, Zap, Shield } from 'lucide-react';
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
    getReoonSettings,
    saveReoonSettings,
    checkAccountBalance,
    verifyEmails,
    detectEmailColumn,
    extractEmails,
    reoonProcessingState,
    getStatusLabel,
    REOON_RESULT_COLUMN,
    REOON_RESULT_DISPLAY,
    type ReoonVerificationResult
} from '@/services/reoonService';

interface ReoonEmailDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    displayOrder?: number[];
    initialRowRange?: string;
}

type Step = 'settings' | 'configure' | 'running';
type VerificationMode = 'quick' | 'power';
type ApiMode = 'auto' | 'single' | 'bulk';

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

export function ReoonEmailDialog({ open, onOpenChange, displayOrder, initialRowRange }: ReoonEmailDialogProps) {
    const { headers, data, addColumn, updateCell } = useCSVStore();

    // Settings
    const [apiKey, setApiKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [verificationMode, setVerificationMode] = useState<VerificationMode>('power');
    const [apiMode, setApiMode] = useState<ApiMode>('auto');

    // Balance
    const [balance, setBalance] = useState<{ daily: number; instant: number } | null>(null);
    const [checkingBalance, setCheckingBalance] = useState(false);

    // Column selection
    const [emailColumn, setEmailColumn] = useState<string>('');
    const [detectedColumn, setDetectedColumn] = useState<string | null>(null);
    const [resultColumnName, setResultColumnName] = useState('email_status');

    // Row range selection
    const [rowRange, setRowRange] = useState<string>('');
    const [rowRangeMode, setRowRangeMode] = useState<'all' | 'range'>('all');

    // Running state
    const [step, setStep] = useState<Step>('settings');
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState('');
    const [error, setError] = useState<string | null>(null);

    // Compute effective row indices
    const effectiveRowIndices = useMemo(() => {
        const order = displayOrder || data.map((_, i) => i);
        if (rowRangeMode === 'all') return order;
        const parsedRange = parseRowRange(rowRange, order.length);
        if (parsedRange.length === 0) return order;
        return parsedRange.map(i => order[i]).filter(i => i !== undefined);
    }, [displayOrder, data, rowRange, rowRangeMode]);

    // Count emails to verify
    const emailCount = useMemo(() => {
        if (!emailColumn) return 0;
        const rowsToUse = effectiveRowIndices.map(i => data[i]).filter(Boolean);
        return extractEmails(rowsToUse, emailColumn).filter(e => e.trim()).length;
    }, [emailColumn, effectiveRowIndices, data]);

    // Load settings on open
    useEffect(() => {
        if (open) {
            const settings = getReoonSettings();
            setApiKey(settings.apiKey || '');
            setVerificationMode(settings.verificationMode || 'power');
            setStep(settings.apiKey ? 'configure' : 'settings');
            setError(null);
            setBalance(null);

            // Auto-detect email column
            const detected = detectEmailColumn(headers, data);
            setDetectedColumn(detected);
            if (detected) {
                setEmailColumn(detected);
            }

            // Handle initial row range
            if (initialRowRange) {
                setRowRange(initialRowRange);
                setRowRangeMode('range');
            } else {
                setRowRange('');
                setRowRangeMode('all');
            }
        }
    }, [open, headers, data, initialRowRange]);

    const handleSaveSettings = useCallback(() => {
        if (!apiKey.trim()) {
            toast.error('Please enter your Reoon API key');
            return;
        }
        saveReoonSettings({ apiKey: apiKey.trim(), verificationMode });
        toast.success('API key saved');
        setStep('configure');
    }, [apiKey, verificationMode]);

    const handleCheckBalance = useCallback(async () => {
        setCheckingBalance(true);
        try {
            const result = await checkAccountBalance();
            setBalance({
                daily: result.remaining_daily_credits,
                instant: result.remaining_instant_credits
            });
            toast.success(`Balance: ${result.remaining_instant_credits} instant credits, ${result.remaining_daily_credits} daily credits`);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to check balance';
            toast.error(message);
        } finally {
            setCheckingBalance(false);
        }
    }, []);

    const handleStartVerification = useCallback(async () => {
        if (!emailColumn) {
            toast.error('Please select an email column');
            return;
        }

        // Get emails to verify
        const rowsToUse = effectiveRowIndices.map(i => data[i]).filter(Boolean);
        const emails = extractEmails(rowsToUse, emailColumn);
        const validEmails = emails.filter(e => e.trim());

        if (validEmails.length === 0) {
            toast.error('No valid emails found in selected column/rows');
            return;
        }

        // Check if using bulk API and have less than 10 emails
        if (apiMode === 'bulk' && validEmails.length < 10) {
            toast.error('Bulk API requires at least 10 emails. Use Auto or Single mode instead.');
            return;
        }

        setIsRunning(true);
        setError(null);
        setStep('running');

        // Start global processing state
        const useBulk = apiMode === 'bulk' || (apiMode === 'auto' && validEmails.length >= 10);
        const controller = reoonProcessingState.start(validEmails.length, useBulk ? 'bulk' : 'single');

        try {
            const results = await verifyEmails(validEmails, {
                mode: apiMode,
                onProgress: (processed, total, status) => {
                    setProgress(status || `Verifying ${processed}/${total}...`);
                    reoonProcessingState.update(processed);
                },
                signal: controller.signal
            });

            // Create result column if it doesn't exist
            const columnName = resultColumnName.trim() || 'email_status';
            if (!headers.includes(columnName)) {
                addColumn(columnName, '');
            }

            // Map results back to rows
            let verifiedCount = 0;
            for (const rowIdx of effectiveRowIndices) {
                const row = data[rowIdx];
                if (!row) continue;

                const email = (row[emailColumn] || '').trim().toLowerCase();
                if (!email) continue;

                const result = results.get(email);
                if (result) {
                    // Store the verification status
                    updateCell(rowIdx, columnName, getStatusLabel(result.status));
                    verifiedCount++;
                }
            }

            reoonProcessingState.finish();
            toast.success(`Verified ${verifiedCount} emails. Results added to "${columnName}" column.`);
            onOpenChange(false);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
            toast.error(message);
            reoonProcessingState.finish();
            setStep('configure');
        } finally {
            setIsRunning(false);
        }
    }, [emailColumn, effectiveRowIndices, data, apiMode, resultColumnName, headers, addColumn, updateCell, onOpenChange]);

    const recommendedMode = emailCount >= 10 ? 'bulk' : 'single';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Mail className="w-5 h-5 text-green-500" />
                        Verify Emails with Reoon
                    </DialogTitle>
                    <DialogDescription>
                        {step === 'settings' && 'Configure your Reoon API key'}
                        {step === 'configure' && 'Select email column and verification options'}
                        {step === 'running' && 'Verifying emails...'}
                    </DialogDescription>
                </DialogHeader>

                {/* Step indicator */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                    <span className={step === 'settings' ? 'text-primary font-medium' : ''}>Settings</span>
                    <ChevronRight className="w-3 h-3" />
                    <span className={step === 'configure' ? 'text-primary font-medium' : ''}>Configure</span>
                    <ChevronRight className="w-3 h-3" />
                    <span className={step === 'running' ? 'text-primary font-medium' : ''}>Verify</span>
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
                            <Label>Reoon API Key</Label>
                            <div className="flex gap-2">
                                <Input
                                    type={showKey ? 'text' : 'password'}
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder="Your Reoon API key..."
                                    className="flex-1"
                                />
                                <Button variant="outline" size="sm" onClick={() => setShowKey(!showKey)}>
                                    {showKey ? 'Hide' : 'Show'}
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Get your API key from{' '}
                                <a
                                    href="https://www.reoon.com/"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary underline"
                                >
                                    reoon.com
                                </a>
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label>Verification Mode</Label>
                            <Select value={verificationMode} onValueChange={(v) => setVerificationMode(v as VerificationMode)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="quick">
                                        <div className="flex items-center gap-2">
                                            <Zap className="w-4 h-4 text-yellow-500" />
                                            <span>Quick (~0.5s) - Basic checks only</span>
                                        </div>
                                    </SelectItem>
                                    <SelectItem value="power">
                                        <div className="flex items-center gap-2">
                                            <Shield className="w-4 h-4 text-green-500" />
                                            <span>Power (1-30s) - Full inbox verification</span>
                                        </div>
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Power mode checks if the actual inbox exists but takes longer
                            </p>
                        </div>

                        <DialogFooter>
                            <Button onClick={handleSaveSettings}>
                                <Settings className="w-4 h-4 mr-2" />
                                Save & Continue
                            </Button>
                        </DialogFooter>
                    </div>
                )}

                {/* Configure Step */}
                {step === 'configure' && (
                    <div className="space-y-4">
                        {/* Balance check */}
                        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                            <div>
                                {balance ? (
                                    <span className="text-sm">
                                        <strong>{balance.instant}</strong> instant credits,{' '}
                                        <strong>{balance.daily}</strong> daily credits
                                    </span>
                                ) : (
                                    <span className="text-sm text-muted-foreground">Check your credit balance</span>
                                )}
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleCheckBalance}
                                disabled={checkingBalance}
                            >
                                {checkingBalance ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <RefreshCw className="w-4 h-4" />
                                )}
                                <span className="ml-2">Check Balance</span>
                            </Button>
                        </div>

                        {/* Email column selection */}
                        <div className="space-y-2">
                            <Label>Email Column</Label>
                            <Select value={emailColumn} onValueChange={setEmailColumn}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select column with emails..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {headers.map(h => (
                                        <SelectItem key={h} value={h}>
                                            {h} {h === detectedColumn && '(auto-detected)'}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {emailColumn && emailCount > 0 && (
                                <p className="text-sm text-green-600">
                                    ✓ Found <strong>{emailCount}</strong> emails to verify
                                </p>
                            )}
                        </div>

                        {/* Row Range Selection */}
                        <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
                            <Label>Rows to Process</Label>
                            <div className="flex items-center gap-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="rowRangeMode"
                                        checked={rowRangeMode === 'all'}
                                        onChange={() => setRowRangeMode('all')}
                                        className="w-4 h-4"
                                    />
                                    <span className="text-sm">All Rows ({data.length})</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="rowRangeMode"
                                        checked={rowRangeMode === 'range'}
                                        onChange={() => setRowRangeMode('range')}
                                        className="w-4 h-4"
                                    />
                                    <span className="text-sm">Specific Rows</span>
                                </label>
                            </div>
                            {rowRangeMode === 'range' && (
                                <div className="mt-2">
                                    <Input
                                        value={rowRange}
                                        onChange={(e) => setRowRange(e.target.value)}
                                        placeholder="e.g., 1-10, 15, 20-25"
                                        className="font-mono text-sm"
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {effectiveRowIndices.length} rows selected
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* API Mode Selection */}
                        <div className="space-y-2">
                            <Label>API Mode</Label>
                            <Select value={apiMode} onValueChange={(v) => setApiMode(v as ApiMode)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="auto">
                                        Auto (recommended: {recommendedMode} for {emailCount} emails)
                                    </SelectItem>
                                    <SelectItem value="single">
                                        Single API - Verify one by one (best for &lt;10 emails)
                                    </SelectItem>
                                    <SelectItem value="bulk">
                                        Bulk API - Submit all at once (best for 10+ emails)
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Bulk API is more efficient but requires at least 10 emails
                            </p>
                        </div>

                        {/* Result column name */}
                        <div className="space-y-2">
                            <Label>Result Column Name</Label>
                            <Input
                                value={resultColumnName}
                                onChange={(e) => setResultColumnName(e.target.value)}
                                placeholder="email_status"
                            />
                        </div>

                        <DialogFooter className="flex justify-between">
                            <Button variant="outline" onClick={() => setStep('settings')}>
                                Change Settings
                            </Button>
                            <Button
                                onClick={handleStartVerification}
                                disabled={!emailColumn || emailCount === 0}
                            >
                                <Play className="w-4 h-4 mr-2" />
                                Verify {emailCount} Emails
                            </Button>
                        </DialogFooter>
                    </div>
                )}

                {/* Running Step */}
                {step === 'running' && (
                    <div className="flex flex-col items-center justify-center py-8 space-y-6">
                        <Loader2 className="w-12 h-12 animate-spin text-green-500" />
                        <div className="w-full max-w-md space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-medium">{progress || 'Starting...'}</span>
                                {reoonProcessingState.totalCount > 0 && (
                                    <span className="text-muted-foreground">
                                        {reoonProcessingState.processedCount}/{reoonProcessingState.totalCount}
                                    </span>
                                )}
                            </div>
                            {/* Progress Bar */}
                            {reoonProcessingState.totalCount > 0 && (
                                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-green-500 transition-all duration-300"
                                        style={{
                                            width: `${Math.round(
                                                (reoonProcessingState.processedCount / reoonProcessingState.totalCount) * 100
                                            )}%`
                                        }}
                                    />
                                </div>
                            )}
                            <p className="text-xs text-muted-foreground text-center">
                                {reoonProcessingState.mode === 'bulk'
                                    ? 'Using Bulk API - verification happens on Reoon servers'
                                    : 'Using Single API - verifying one by one'}
                            </p>
                            {reoonProcessingState.taskId && (
                                <p className="text-xs text-muted-foreground text-center">
                                    Task ID: {reoonProcessingState.taskId}
                                </p>
                            )}
                        </div>
                        <Button
                            variant="outline"
                            onClick={() => {
                                reoonProcessingState.cancel();
                                setIsRunning(false);
                                setStep('configure');
                                toast.info('Verification cancelled');
                            }}
                        >
                            Cancel
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
