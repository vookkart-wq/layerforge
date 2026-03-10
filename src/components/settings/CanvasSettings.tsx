import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCanvasStore } from '@/stores/useCanvasStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { useCSVStore } from '@/stores/useCSVStore';
import { createOffscreenRenderer } from '@/services/CanvasRenderer';

export function CanvasSettings() {
    const { canvasConfig, setCanvasConfig } = useCanvasStore();

    const presets = [
        { name: 'HD', width: 1280, height: 720 },
        { name: 'Full HD', width: 1920, height: 1080 },
        { name: 'Square', width: 1080, height: 1080 },
        { name: 'Story', width: 1080, height: 1920 },
        { name: '4K', width: 3840, height: 2160 },
    ];

    return (
        <Card>
            <CardHeader>
                <CardTitle>Canvas Settings</CardTitle>
                <CardDescription>Configure your canvas dimensions and background</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Presets */}
                <div className="space-y-2">
                    <Label>Presets</Label>
                    <div className="grid grid-cols-3 gap-2">
                        {presets.slice(0, 3).map((preset) => (
                            <Button
                                key={preset.name}
                                variant="outline"
                                size="sm"
                                onClick={() => setCanvasConfig({ width: preset.width, height: preset.height })}
                            >
                                {preset.name}
                            </Button>
                        ))}
                    </div>
                </div>

                {/* Maintain Ratio Toggle */}
                <div className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        id="canvasMaintainRatio"
                        checked={canvasConfig.maintainRatio ?? false}
                        onChange={(e) => {
                            if (e.target.checked) {
                                // Store the current aspect ratio when enabling
                                const ratio = canvasConfig.width / canvasConfig.height;
                                setCanvasConfig({ maintainRatio: true, aspectRatio: ratio });
                            } else {
                                setCanvasConfig({ maintainRatio: false });
                            }
                        }}
                        className="rounded"
                    />
                    <Label htmlFor="canvasMaintainRatio" className="cursor-pointer text-sm">
                        🔗 Maintain aspect ratio
                    </Label>
                </div>

                {/* Dimensions */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Width (px)</Label>
                        <Input
                            type="number"
                            value={canvasConfig.width}
                            onChange={(e) => {
                                const newWidth = parseInt(e.target.value) || 1080;
                                if (canvasConfig.maintainRatio && canvasConfig.aspectRatio) {
                                    const newHeight = Math.round(newWidth / canvasConfig.aspectRatio);
                                    setCanvasConfig({ width: newWidth, height: newHeight });
                                } else {
                                    setCanvasConfig({ width: newWidth });
                                }
                            }}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Height (px)</Label>
                        <Input
                            type="number"
                            value={canvasConfig.height}
                            onChange={(e) => {
                                const newHeight = parseInt(e.target.value) || 1080;
                                if (canvasConfig.maintainRatio && canvasConfig.aspectRatio) {
                                    const newWidth = Math.round(newHeight * canvasConfig.aspectRatio);
                                    setCanvasConfig({ height: newHeight, width: newWidth });
                                } else {
                                    setCanvasConfig({ height: newHeight });
                                }
                            }}
                        />
                    </div>
                </div>

                {/* Background Color */}
                <div className="space-y-2">
                    <Label>Background Color</Label>
                    <div className="flex gap-2">
                        <Input
                            type="color"
                            value={canvasConfig.backgroundColor}
                            onChange={(e) => setCanvasConfig({ backgroundColor: e.target.value })}
                            className="w-14 h-10 p-1 cursor-pointer"
                        />
                        <Input
                            type="text"
                            value={canvasConfig.backgroundColor}
                            onChange={(e) => setCanvasConfig({ backgroundColor: e.target.value })}
                            className="flex-1 font-mono"
                        />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

export function OutputSettings() {
    const { outputConfig, setOutputConfig, canvasConfig, previewRowIndex } = useCanvasStore();
    const layers = useLayerStore((s) => s.layers);
    const { data: csvData, getSortedIndices } = useCSVStore();

    const [estimatedSize, setEstimatedSize] = useState<string>('');
    const [calculating, setCalculating] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Calculate file size with debounce
    useEffect(() => {
        // Clear previous timeout
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        // Don't calculate if no layers or data
        if (layers.length === 0 || csvData.length === 0) {
            setEstimatedSize('');
            return;
        }

        setCalculating(true);

        // Debounce 500ms
        debounceRef.current = setTimeout(async () => {
            try {
                // Use sorted indices to get the correct row based on visual order
                const sortedIndices = getSortedIndices();
                const actualRowIndex = sortedIndices[previewRowIndex];
                const currentRow = csvData[actualRowIndex] || {};
                const renderer = createOffscreenRenderer(canvasConfig);
                await renderer.render(layers, currentRow);

                const dataURL = renderer.toDataURL(
                    outputConfig.format,
                    outputConfig.quality,
                    Math.max(outputConfig.width / canvasConfig.width, outputConfig.height / canvasConfig.height)
                );

                // Calculate blob size
                const base64Data = dataURL.split(',')[1];
                const sizeInBytes = Math.round((base64Data.length * 3) / 4);

                // Format size
                if (sizeInBytes < 1024) {
                    setEstimatedSize(`${sizeInBytes} B`);
                } else if (sizeInBytes < 1024 * 1024) {
                    setEstimatedSize(`${(sizeInBytes / 1024).toFixed(1)} KB`);
                } else {
                    setEstimatedSize(`${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`);
                }
            } catch (error) {
                console.error('Error calculating file size:', error);
                setEstimatedSize('N/A');
            } finally {
                setCalculating(false);
            }
        }, 500);

        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, [outputConfig.format, outputConfig.quality, outputConfig.width, outputConfig.height, layers, csvData, previewRowIndex, canvasConfig]);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center justify-between">
                    <span>Output Settings</span>
                    {/* File Size Display */}
                    {(calculating || estimatedSize) && (
                        <span className="text-sm font-normal text-muted-foreground">
                            📊 {calculating ? 'Calculating...' : `~${estimatedSize}`}
                        </span>
                    )}
                </CardTitle>
                <CardDescription>Configure final image format and quality</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Maintain Ratio Toggle */}
                <div className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        id="maintainRatio"
                        checked={outputConfig.maintainRatio ?? true}
                        onChange={(e) => {
                            if (e.target.checked) {
                                // Store the canvas aspect ratio when enabling
                                const ratio = canvasConfig.width / canvasConfig.height;
                                setOutputConfig({ maintainRatio: true, aspectRatio: ratio });
                            } else {
                                setOutputConfig({ maintainRatio: false });
                            }
                        }}
                        className="rounded"
                    />
                    <Label htmlFor="maintainRatio" className="cursor-pointer text-sm">
                        🔗 Maintain aspect ratio
                    </Label>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Width (px)</Label>
                        <Input
                            type="number"
                            value={outputConfig.width}
                            onChange={(e) => {
                                const newWidth = parseInt(e.target.value) || 1080;
                                // Use stored aspectRatio, or fall back to canvas ratio
                                const ratio = outputConfig.aspectRatio ?? (canvasConfig.width / canvasConfig.height);
                                if (outputConfig.maintainRatio !== false) {
                                    const newHeight = Math.round(newWidth / ratio);
                                    setOutputConfig({ width: newWidth, height: newHeight });
                                } else {
                                    setOutputConfig({ width: newWidth });
                                }
                            }}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Height (px)</Label>
                        <Input
                            type="number"
                            value={outputConfig.height}
                            onChange={(e) => {
                                const newHeight = parseInt(e.target.value) || 1080;
                                // Use stored aspectRatio, or fall back to canvas ratio
                                const ratio = outputConfig.aspectRatio ?? (canvasConfig.width / canvasConfig.height);
                                if (outputConfig.maintainRatio !== false) {
                                    const newWidth = Math.round(newHeight * ratio);
                                    setOutputConfig({ height: newHeight, width: newWidth });
                                } else {
                                    setOutputConfig({ height: newHeight });
                                }
                            }}
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <Label>Format</Label>
                    <Select
                        value={outputConfig.format}
                        onValueChange={(value: 'png' | 'jpeg' | 'webp') => setOutputConfig({ format: value })}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="png">PNG (Lossless)</SelectItem>
                            <SelectItem value="jpeg">JPEG (Smaller size)</SelectItem>
                            <SelectItem value="webp">WebP (Best compression)</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {outputConfig.format !== 'png' && (
                    <div className="space-y-2">
                        <Label>Quality ({outputConfig.quality}%)</Label>
                        <Input
                            type="range"
                            min={10}
                            max={100}
                            value={outputConfig.quality}
                            onChange={(e) => setOutputConfig({ quality: parseInt(e.target.value) })}
                        />
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
