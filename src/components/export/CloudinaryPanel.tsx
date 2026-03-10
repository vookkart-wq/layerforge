import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Upload, CheckCircle2, XCircle, AlertCircle, Pause, Play } from 'lucide-react';
import { toast } from 'sonner';
import { useLayerStore } from '@/stores/useLayerStore';
import { useCanvasStore } from '@/stores/useCanvasStore';
import { useCSVStore } from '@/stores/useCSVStore';
import { createOffscreenRenderer } from '@/services/CanvasRenderer';
import { OutputSettings } from '@/components/settings/CanvasSettings';
import { UploadStatus } from '@/types';
import pLimit from 'p-limit';

export function CloudinaryPanel() {
    const [uploading, setUploading] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const isCancelledRef = useRef(false);
    const isPausedRef = useRef(false);
    const resumeResolversRef = useRef<Array<() => void>>([]);
    const [uploadStatuses, setUploadStatuses] = useState<UploadStatus[]>([]);
    const [csvContent, setCsvContent] = useState('');
    const [rangeStart, setRangeStart] = useState(1);
    const [rangeEnd, setRangeEnd] = useState(1);
    const [fastMode, setFastMode] = useState(false);
    const [concurrencyLimit, setConcurrencyLimit] = useState(6);
    const [filenameColumn, setFilenameColumn] = useState('__default__');

    const [cloudName, setCloudName] = useState(() => localStorage.getItem('cloudinary_cloud_name') || '');
    const [uploadPreset, setUploadPreset] = useState(() => localStorage.getItem('cloudinary_upload_preset') || '');

    const layers = useLayerStore((s) => s.layers);
    const { canvasConfig, outputConfig } = useCanvasStore();
    const { data: csvData, headers: csvHeaders, getSortedIndices, addColumn, updateCells } = useCSVStore();

    // Persist Cloudinary settings
    useEffect(() => {
        localStorage.setItem('cloudinary_cloud_name', cloudName);
    }, [cloudName]);

    useEffect(() => {
        localStorage.setItem('cloudinary_upload_preset', uploadPreset);
    }, [uploadPreset]);

    useEffect(() => {
        setRangeStart(1);
        setRangeEnd(csvData.length || 1);
    }, [csvData.length]);

    const handleUpload = async () => {
        if (!cloudName || !uploadPreset) {
            toast.error('Please configure Cloudinary settings');
            return;
        }

        if (layers.length === 0) {
            toast.error('Please add at least one layer');
            return;
        }

        if (csvData.length === 0) {
            toast.error('Please upload CSV data first');
            return;
        }

        isCancelledRef.current = false;
        isPausedRef.current = false;
        setIsPaused(false);
        setUploading(true);
        setUploadStatuses([]);

        const start = Math.max(1, Math.min(rangeStart, csvData.length));
        const end = Math.max(start, Math.min(rangeEnd, csvData.length));

        // Helper to wait while paused - each task registers its own resolver
        const waitForResume = async () => {
            if (!isPausedRef.current) return;
            await new Promise<void>((resolve) => {
                resumeResolversRef.current.push(resolve);
            });
        };

        // Helper to build a clean public_id from the selected column
        const buildPublicId = (row: Record<string, string>, rowIndex: number): string => {
            if (filenameColumn === '__default__') {
                return `image-row-${rowIndex + 1}`;
            }
            const rawValue = row[filenameColumn] || `row-${rowIndex + 1}`;
            // Sanitize: replace spaces with underscores, remove non-URL-safe chars
            return rawValue.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '') || `row-${rowIndex + 1}`;
        };

        // Get sorted indices to match display order in CSV editor
        const sortedIndices = getSortedIndices();

        // Initialize status array - use sorted indices for proper ordering
        const statusArray: UploadStatus[] = [];
        for (let i = start - 1; i < end; i++) {
            const actualIndex = sortedIndices[i];
            const displayName = buildPublicId(csvData[actualIndex], actualIndex);
            statusArray.push({ name: displayName, status: 'pending' });
        }
        setUploadStatuses(statusArray);

        const results: Array<{ name: string; url: string; rowData: any; sortOrder: number }> = [];
        const limit = pLimit(concurrencyLimit);

        // statusIdx: position in the status array (0-based from range start)
        // actualRowIndex: the real index in csvData based on sorted order
        const uploadTask = async (statusIdx: number, actualRowIndex: number) => {
            if (isCancelledRef.current) return;

            // Wait if paused
            await waitForResume();
            if (isCancelledRef.current) return;

            const currentRow = csvData[actualRowIndex];

            // Update status to uploading
            setUploadStatuses((prev) =>
                prev.map((status, idx) =>
                    idx === statusIdx ? { ...status, status: 'uploading' } : status
                )
            );

            try {
                // Create offscreen renderer and generate image
                const renderer = createOffscreenRenderer(canvasConfig);
                await renderer.render(layers, currentRow);

                const dataURL = renderer.toDataURL(
                    outputConfig.format,
                    outputConfig.quality,
                    Math.max(outputConfig.width / canvasConfig.width, outputConfig.height / canvasConfig.height)
                );

                // Convert to blob
                const base64Data = dataURL.split(',')[1];
                const byteCharacters = atob(base64Data);
                const byteNumbers = new Array(byteCharacters.length);
                for (let j = 0; j < byteCharacters.length; j++) {
                    byteNumbers[j] = byteCharacters.charCodeAt(j);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: `image/${outputConfig.format}` });

                // Upload to Cloudinary
                const publicId = buildPublicId(currentRow, actualRowIndex);
                const formData = new FormData();
                formData.append('file', blob, `${publicId}.${outputConfig.format}`);
                formData.append('upload_preset', uploadPreset);

                const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
                    method: 'POST',
                    body: formData,
                });

                if (!response.ok) {
                    throw new Error(`Upload failed: ${response.statusText}`);
                }

                const data = await response.json();

                // Remove version number from URL (e.g. /v1234567890/) for cleaner, shorter links
                const cleanUrl = (data.secure_url as string).replace(/\/v\d+\//, '/');

                setUploadStatuses((prev) =>
                    prev.map((status, idx) =>
                        idx === statusIdx ? { ...status, status: 'success', url: cleanUrl } : status
                    )
                );

                results.push({ name: publicId, url: cleanUrl, rowData: currentRow, sortOrder: statusIdx });
            } catch (error) {
                console.error(`Error processing row ${actualRowIndex + 1}:`, error);
                const errorMessage = error instanceof Error ? error.message : 'Upload failed';

                setUploadStatuses((prev) =>
                    prev.map((status, idx) =>
                        idx === statusIdx ? { ...status, status: 'error', error: errorMessage } : status
                    )
                );
            }
        };

        if (fastMode) {
            const tasks = [];
            for (let i = start - 1; i < end; i++) {
                if (isCancelledRef.current) break;
                const statusIdx = i - (start - 1);
                const actualRowIndex = sortedIndices[i];
                tasks.push(limit(() => uploadTask(statusIdx, actualRowIndex)));
            }
            await Promise.allSettled(tasks);
        } else {
            for (let i = start - 1; i < end; i++) {
                if (isCancelledRef.current) break;
                const statusIdx = i - (start - 1);
                const actualRowIndex = sortedIndices[i];
                await uploadTask(statusIdx, actualRowIndex);
            }
        }

        // Generate CSV with Cloudinary URLs
        // Find a unique column name if cloudinary_url already exists
        let newColumnName = 'cloudinary_url';
        if (csvHeaders.includes('cloudinary_url')) {
            // Try cloudinary_url_new, then cloudinary_url_2, cloudinary_url_3, etc.
            if (!csvHeaders.includes('cloudinary_url_new')) {
                newColumnName = 'cloudinary_url_new';
            } else {
                let suffix = 2;
                while (csvHeaders.includes(`cloudinary_url_${suffix}`)) {
                    suffix++;
                }
                newColumnName = `cloudinary_url_${suffix}`;
            }
        }

        // Sort results by sortOrder to maintain display order in output CSV
        results.sort((a, b) => a.sortOrder - b.sortOrder);

        const csvRows = [
            [...csvHeaders, newColumnName].join(','),
            ...results.map((r) => {
                const rowData = csvHeaders.map((header) => {
                    const value = r.rowData[header];
                    return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
                });
                return [...rowData, r.url].join(',');
            }),
        ];

        setCsvContent(csvRows.join('\n'));

        // Sync URLs back to CSV Editor store
        // This allows users to see the URLs when they go back to CSV Editor
        if (results.length > 0) {
            // Create a unique column name for this batch
            let syncColumnName = 'cloudinary_url';
            if (csvHeaders.includes('cloudinary_url')) {
                let suffix = 2;
                while (csvHeaders.includes(`cloudinary_url_${suffix}`)) {
                    suffix++;
                }
                syncColumnName = `cloudinary_url_${suffix}`;
            }

            // Add the new column to CSV store (empty by default)
            addColumn(syncColumnName, '');

            // Build updates for all successfully uploaded rows
            // We need to map back to original row indices
            const cellUpdates: { rowIndex: number; header: string; value: string }[] = [];

            // Create a lookup from row data to find the actual original index
            for (const result of results) {
                // result.sortOrder is the position in the range (0-based from start-1)
                // We need to find the actual row index in csvData
                const rangePosition = result.sortOrder;
                const actualRowIndex = sortedIndices[start - 1 + rangePosition];

                if (actualRowIndex !== undefined) {
                    cellUpdates.push({
                        rowIndex: actualRowIndex,
                        header: syncColumnName,
                        value: result.url
                    });
                }
            }

            // Batch update all cells
            if (cellUpdates.length > 0) {
                updateCells(cellUpdates);
            }
        }

        setUploading(false);

        if (isCancelledRef.current) {
            toast.info('Upload cancelled');
        } else {
            toast.success('Batch upload completed!');
        }
    };

    const handleStop = () => {
        isCancelledRef.current = true;
        isPausedRef.current = false;
        setIsPaused(false);
        // Resume all paused tasks to allow clean exit
        resumeResolversRef.current.forEach(resolve => resolve());
        resumeResolversRef.current = [];
        toast.info('Stopping upload...');
    };

    const handlePause = () => {
        isPausedRef.current = true;
        setIsPaused(true);
        toast.info('Upload paused');
    };

    const handleResume = () => {
        isPausedRef.current = false;
        setIsPaused(false);
        // Resume all waiting tasks
        resumeResolversRef.current.forEach(resolve => resolve());
        resumeResolversRef.current = [];
        toast.info('Upload resumed');
    };

    const handleDownloadCSV = () => {
        if (!csvContent) return;

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `cloudinary-uploads-${Date.now()}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success('CSV downloaded');
    };

    const progress = uploadStatuses.length > 0
        ? (uploadStatuses.filter((s) => s.status === 'success' || s.status === 'error').length / uploadStatuses.length) * 100
        : 0;

    return (
        <Card className="p-6 max-w-4xl mx-auto">
            <h3 className="text-lg font-semibold mb-4">Cloudinary Upload</h3>

            {layers.length === 0 ? (
                <div className="flex items-center gap-2 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm">
                    <AlertCircle className="w-4 h-4 text-yellow-500" />
                    <p>Please add layers in the Editor tab first</p>
                </div>
            ) : (
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Generate and upload images directly to Cloudinary
                    </p>

                    {/* Cloudinary Settings */}
                    <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                        <div className="space-y-2">
                            <Label>Cloud Name</Label>
                            <Input
                                value={cloudName}
                                onChange={(e) => setCloudName(e.target.value)}
                                placeholder="your-cloud-name"
                                disabled={uploading}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Upload Preset</Label>
                            <Input
                                value={uploadPreset}
                                onChange={(e) => setUploadPreset(e.target.value)}
                                placeholder="your-preset"
                                disabled={uploading}
                            />
                        </div>
                    </div>

                    {/* Filename Column Selector */}
                    <div className="p-4 bg-muted/50 rounded-lg">
                        <p className="text-sm font-medium mb-3">🏷️ Image Filename</p>
                        <div className="space-y-2">
                            <Label>Use CSV column as filename</Label>
                            <Select value={filenameColumn} onValueChange={setFilenameColumn} disabled={uploading}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Default (image-row-N)" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__default__">Default (image-row-N)</SelectItem>
                                    {csvHeaders.map((header) => (
                                        <SelectItem key={header} value={header}>{header}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                {filenameColumn === '__default__'
                                    ? 'Files will be named: image-row-1, image-row-2, etc.'
                                    : `Files will be named using the "${filenameColumn}" column value`}
                            </p>
                        </div>
                    </div>

                    {/* Output Settings - so user remembers to check */}
                    <div className="p-4 bg-muted/50 rounded-lg">
                        <p className="text-sm font-medium mb-3">📦 Output Settings</p>
                        <OutputSettings />
                    </div>

                    {/* Range & Options */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <Label>From</Label>
                        <Input
                            type="number"
                            min={1}
                            max={csvData.length || 1}
                            value={rangeStart}
                            onChange={(e) => setRangeStart(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-20"
                            disabled={uploading}
                        />
                        <Label>To</Label>
                        <Input
                            type="number"
                            min={1}
                            max={csvData.length || 1}
                            value={rangeEnd}
                            onChange={(e) => setRangeEnd(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-20"
                            disabled={uploading}
                        />
                        <div className="flex items-center gap-2 ml-4">
                            <input
                                type="checkbox"
                                id="fastMode"
                                checked={fastMode}
                                onChange={(e) => setFastMode(e.target.checked)}
                                disabled={uploading}
                            />
                            <Label htmlFor="fastMode" className="cursor-pointer">Fast Mode</Label>
                            {fastMode && (
                                <>
                                    <Label className="ml-2">Concurrent:</Label>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={20}
                                        value={concurrencyLimit}
                                        onChange={(e) => setConcurrencyLimit(Math.max(1, Math.min(20, parseInt(e.target.value) || 6)))}
                                        className="w-16"
                                        disabled={uploading}
                                    />
                                </>
                            )}
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-2">
                        <Button
                            onClick={handleUpload}
                            disabled={uploading || csvData.length === 0 || !cloudName || !uploadPreset}
                            className="flex-1"
                            size="lg"
                        >
                            <Upload className="w-4 h-4 mr-2" />
                            {uploading ? 'Uploading...' : `Upload Range (${rangeStart}-${rangeEnd})`}
                        </Button>
                        {uploading && (
                            <>
                                {isPaused ? (
                                    <Button onClick={handleResume} variant="outline" size="lg">
                                        <Play className="w-4 h-4 mr-2" />
                                        Resume
                                    </Button>
                                ) : (
                                    <Button onClick={handlePause} variant="outline" size="lg">
                                        <Pause className="w-4 h-4 mr-2" />
                                        Pause
                                    </Button>
                                )}
                                <Button onClick={handleStop} variant="destructive" size="lg">
                                    <XCircle className="w-4 h-4 mr-2" />
                                    Stop
                                </Button>
                            </>
                        )}
                    </div>

                    {/* Progress */}
                    {uploadStatuses.length > 0 && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span>Progress</span>
                                <span>{Math.round(progress)}%</span>
                            </div>
                            <Progress value={progress} />
                        </div>
                    )}

                    {/* Status List */}
                    {uploadStatuses.length > 0 && (
                        <div className="space-y-2 max-h-64 overflow-y-auto border rounded-lg p-2">
                            {uploadStatuses.map((status, idx) => (
                                <div key={idx} className="flex items-center justify-between p-2 bg-secondary/50 rounded text-sm">
                                    <span className="truncate flex-1 font-medium">{status.name}</span>
                                    <div className="flex items-center gap-2 ml-2">
                                        {status.status === 'pending' && <span className="text-muted-foreground">Pending</span>}
                                        {status.status === 'uploading' && <span className="text-primary animate-pulse">Uploading...</span>}
                                        {status.status === 'success' && (
                                            <div className="flex items-center gap-1 text-green-600">
                                                <CheckCircle2 className="w-4 h-4" />
                                                <span className="text-xs">Done</span>
                                            </div>
                                        )}
                                        {status.status === 'error' && (
                                            <div className="flex items-center gap-1 text-destructive">
                                                <XCircle className="w-4 h-4" />
                                                <span className="text-xs">{status.error}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Download CSV */}
                    {csvContent && (
                        <Button onClick={handleDownloadCSV} variant="outline" className="w-full" size="lg">
                            <Download className="w-4 h-4 mr-2" />
                            Download CSV with Cloudinary URLs
                        </Button>
                    )}
                </div>
            )}
        </Card>
    );
}
