import { useEffect, useRef, useState, useMemo } from 'react';
import { Canvas as FabricCanvas } from 'fabric';
import { ZoomIn, ZoomOut, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLayerStore } from '@/stores/useLayerStore';
import { useCanvasStore } from '@/stores/useCanvasStore';
import { useCSVStore } from '@/stores/useCSVStore';
import { CanvasRenderer } from '@/services/CanvasRenderer';
import { SmartGuides } from '@/services/SmartGuides';
import { toast } from 'sonner';
import JSZip from 'jszip';

export function CanvasPreview() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<CanvasRenderer | null>(null);
    const smartGuidesRef = useRef<SmartGuides | null>(null);

    const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
    const [canvasScale, setCanvasScale] = useState(0.5);
    const [zoomToFit, setZoomToFit] = useState(true);
    const [rangeStart, setRangeStart] = useState(1);
    const [rangeEnd, setRangeEnd] = useState(1);
    const [showDownloadOptions, setShowDownloadOptions] = useState(false);

    const layers = useLayerStore((s) => s.layers);
    const updateLayer = useLayerStore((s) => s.updateLayer);
    const { canvasConfig, outputConfig, previewRowIndex, setPreviewRowIndex, gridSettings, snapValue } = useCanvasStore();
    const { data: csvData, headers: csvHeaders, getSortedIndices } = useCSVStore();

    // Get sorted indices - this maps visual position to actual data index
    const sortedIndices = useMemo(() => getSortedIndices(), [getSortedIndices, csvData]);

    // Get actual row data based on sorted order
    const currentRow = useMemo(() => {
        const actualIndex = sortedIndices[previewRowIndex];
        return csvData[actualIndex] || {};
    }, [sortedIndices, previewRowIndex, csvData]);

    // Initialize canvas
    useEffect(() => {
        if (!canvasRef.current) return;

        const canvas = new FabricCanvas(canvasRef.current, {
            width: canvasConfig.width,
            height: canvasConfig.height,
            backgroundColor: canvasConfig.backgroundColor,
        });
        canvas.preserveObjectStacking = true;

        const renderer = new CanvasRenderer(canvas, canvasConfig);
        rendererRef.current = renderer;

        // Initialize smart guides
        const guides = new SmartGuides(canvas, canvasConfig.width, canvasConfig.height);
        smartGuidesRef.current = guides;

        setFabricCanvas(canvas);

        return () => {
            guides.dispose();
            canvas.dispose();
        };
    }, []);

    // Update canvas config
    useEffect(() => {
        if (!fabricCanvas || !rendererRef.current) return;
        rendererRef.current.updateConfig(canvasConfig);
        // Update smart guides dimensions
        if (smartGuidesRef.current) {
            smartGuidesRef.current.updateDimensions(canvasConfig.width, canvasConfig.height);
        }
    }, [canvasConfig, fabricCanvas]);

    // Calculate scale to fit container - ALWAYS fit
    useEffect(() => {
        const calculateScale = () => {
            const container = containerRef.current;
            if (!container) return;

            const padding = 16;
            const availableWidth = container.clientWidth - padding;
            const availableHeight = container.clientHeight - padding;

            if (availableWidth <= 0 || availableHeight <= 0) return;

            const scaleX = availableWidth / canvasConfig.width;
            const scaleY = availableHeight / canvasConfig.height;

            // Calculate scale to fit, allowing zoom in (up to 3x) and zoom out
            const fitScale = Math.min(scaleX, scaleY);
            // Cap maximum zoom to avoid making tiny canvases too blurry
            const maxZoom = 3;
            const scale = Math.min(fitScale, maxZoom);

            setCanvasScale(Math.max(0.1, scale));
        };

        calculateScale();

        // Use ResizeObserver for responsive scaling
        if (containerRef.current) {
            const resizeObserver = new ResizeObserver(calculateScale);
            resizeObserver.observe(containerRef.current);
            return () => resizeObserver.disconnect();
        }
    }, [zoomToFit, canvasConfig.width, canvasConfig.height]);

    // Reset range end when CSV changes
    useEffect(() => {
        setRangeStart(1);
        setRangeEnd(csvData.length || 1);
    }, [csvData.length]);

    // Render canvas - now uses currentRow which respects sort order
    useEffect(() => {
        if (!rendererRef.current || csvData.length === 0) return;
        rendererRef.current.render(layers, currentRow);
    }, [layers, currentRow, csvData, canvasConfig]);

    // Handle object modification (drag/resize) with smart guides
    useEffect(() => {
        if (!fabricCanvas) return;

        // Real-time snapping while dragging
        const handleObjectMoving = (e: any) => {
            const obj = e.target;
            if (!obj.data?.layerId) return;

            // Only use smart guides if guides are enabled
            if (gridSettings.showGuides && smartGuidesRef.current) {
                const snap = smartGuidesRef.current.handleObjectMoving(obj);
                if (snap.snapped) {
                    if (snap.x !== undefined) obj.set('left', snap.x);
                    if (snap.y !== undefined) obj.set('top', snap.y);
                }
            }
        };

        const handleObjectModified = (e: any) => {
            const obj = e.target;
            const layerId = obj.data?.layerId;
            if (!layerId) return;

            // Clear smart guides
            if (smartGuidesRef.current) {
                smartGuidesRef.current.clearDynamicGuides();
            }

            const updates: any = {
                x: gridSettings.snapToGrid ? snapValue(Math.round(obj.left)) : Math.round(obj.left),
                y: gridSettings.snapToGrid ? snapValue(Math.round(obj.top)) : Math.round(obj.top),
            };

            // Only update dimensions if actually resized (not just moved)
            // This prevents objects from shrinking when just dragging
            if (obj.scaleX !== 1 || obj.scaleY !== 1) {
                updates.width = Math.round((obj.width || 0) * obj.scaleX);
                updates.height = Math.round((obj.height || 0) * obj.scaleY);
            }

            updateLayer(layerId, updates);
        };

        // Clear guides when selection is cleared
        const handleSelectionCleared = () => {
            if (smartGuidesRef.current) {
                smartGuidesRef.current.clearDynamicGuides();
            }
        };

        fabricCanvas.on('object:moving', handleObjectMoving);
        fabricCanvas.on('object:modified', handleObjectModified);
        fabricCanvas.on('selection:cleared', handleSelectionCleared);

        return () => {
            fabricCanvas.off('object:moving', handleObjectMoving);
            fabricCanvas.off('object:modified', handleObjectModified);
            fabricCanvas.off('selection:cleared', handleSelectionCleared);
        };
    }, [fabricCanvas, updateLayer, snapValue, gridSettings.showGuides, gridSettings.snapToGrid]);

    const downloadCurrent = async () => {
        if (!rendererRef.current) return;

        const dataURL = rendererRef.current.toDataURL(
            outputConfig.format,
            outputConfig.quality,
            Math.max(outputConfig.width / canvasConfig.width, outputConfig.height / canvasConfig.height)
        );

        const link = document.createElement('a');
        link.download = `generated-image-row-${previewRowIndex + 1}.${outputConfig.format}`;
        link.href = dataURL;
        link.click();
        toast.success('Image downloaded successfully');
    };

    const downloadRange = async () => {
        if (!rendererRef.current || csvData.length === 0) return;

        const zip = new JSZip();
        const csvRows: string[] = [csvHeaders.join(',')];

        toast.info('Generating images...');

        const start = Math.max(1, Math.min(rangeStart, csvData.length));
        const end = Math.max(start, Math.min(rangeEnd, csvData.length));

        // Use sorted indices for consistent order with editor
        for (let i = start - 1; i < end; i++) {
            const actualIndex = sortedIndices[i];
            const rowData = csvData[actualIndex];
            await rendererRef.current.render(layers, rowData);

            const dataURL = rendererRef.current.toDataURL(
                outputConfig.format,
                outputConfig.quality,
                Math.max(outputConfig.width / canvasConfig.width, outputConfig.height / canvasConfig.height)
            );

            const csvRowData = csvHeaders.map((header) => {
                const value = rowData[header];
                return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
            });
            csvRows.push(csvRowData.join(','));

            const base64Data = dataURL.split(',')[1];
            zip.file(`image-row-${i + 1}.${outputConfig.format}`, base64Data, { base64: true });
        }

        zip.file('output.csv', csvRows.join('\n'));

        const content = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.download = 'generated-images.zip';
        link.href = URL.createObjectURL(content);
        link.click();

        toast.success(`Successfully generated ${end - start + 1} images`);

        // Re-render current preview using sorted row
        rendererRef.current.render(layers, currentRow);
    };

    return (
        <div className="h-full flex flex-col">
            {/* Canvas Container - Takes most space, no scroll */}
            <div
                ref={containerRef}
                className="flex-1 flex items-center justify-center p-2 min-h-0"
                style={{ background: 'repeating-conic-gradient(#80808015 0% 25%, transparent 0% 50%) 50% / 20px 20px' }}
            >
                <div
                    style={{
                        transform: `scale(${canvasScale})`,
                        transformOrigin: 'center',
                        transition: 'transform 0.15s ease',
                    }}
                >
                    <div
                        className="relative"
                        style={{
                            boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                            borderRadius: '2px',
                            overflow: 'hidden',
                            lineHeight: 0,
                        }}
                    >
                        <canvas ref={canvasRef} />

                        {/* Grid Overlay */}
                        {gridSettings.showGrid && (
                            <svg
                                className="pointer-events-none absolute inset-0"
                                width={canvasConfig.width}
                                height={canvasConfig.height}
                                style={{ opacity: 0.3 }}
                            >
                                {/* Vertical lines */}
                                {Array.from({ length: Math.floor(canvasConfig.width / gridSettings.gridSize) }, (_, i) => (
                                    <line
                                        key={`v${i}`}
                                        x1={(i + 1) * gridSettings.gridSize}
                                        y1={0}
                                        x2={(i + 1) * gridSettings.gridSize}
                                        y2={canvasConfig.height}
                                        stroke="#666"
                                        strokeWidth={1}
                                    />
                                ))}
                                {/* Horizontal lines */}
                                {Array.from({ length: Math.floor(canvasConfig.height / gridSettings.gridSize) }, (_, i) => (
                                    <line
                                        key={`h${i}`}
                                        x1={0}
                                        y1={(i + 1) * gridSettings.gridSize}
                                        x2={canvasConfig.width}
                                        y2={(i + 1) * gridSettings.gridSize}
                                        stroke="#666"
                                        strokeWidth={1}
                                    />
                                ))}
                            </svg>
                        )}

                        {/* Center Guides */}
                        {gridSettings.showGuides && (
                            <svg
                                className="pointer-events-none absolute inset-0"
                                width={canvasConfig.width}
                                height={canvasConfig.height}
                            >
                                {/* Vertical center */}
                                <line
                                    x1={canvasConfig.width / 2}
                                    y1={0}
                                    x2={canvasConfig.width / 2}
                                    y2={canvasConfig.height}
                                    stroke="#00bfff"
                                    strokeWidth={1}
                                    strokeDasharray="4 4"
                                    opacity={0.6}
                                />
                                {/* Horizontal center */}
                                <line
                                    x1={0}
                                    y1={canvasConfig.height / 2}
                                    x2={canvasConfig.width}
                                    y2={canvasConfig.height / 2}
                                    stroke="#00bfff"
                                    strokeWidth={1}
                                    strokeDasharray="4 4"
                                    opacity={0.6}
                                />
                            </svg>
                        )}
                    </div>
                </div>
            </div>

            {/* Compact Controls Bar */}
            <div className="flex-shrink-0 bg-background border-t p-2 space-y-2">
                {/* Row navigation + Zoom + Download */}
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setPreviewRowIndex(Math.max(0, previewRowIndex - 1))}
                            disabled={previewRowIndex === 0}
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <span className="text-xs font-medium min-w-[60px] text-center">
                            {previewRowIndex + 1}/{csvData.length || 1}
                        </span>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setPreviewRowIndex(Math.min(csvData.length - 1, previewRowIndex + 1))}
                            disabled={previewRowIndex >= csvData.length - 1}
                        >
                            <ChevronRight className="w-4 h-4" />
                        </Button>
                    </div>

                    <span className="text-xs text-muted-foreground hidden sm:inline">
                        {canvasConfig.width}×{canvasConfig.height} @ {Math.round(canvasScale * 100)}%
                    </span>

                    <div className="flex items-center gap-1">
                        <Button onClick={downloadCurrent} size="sm" className="h-7 text-xs">
                            <Download className="w-3 h-3 mr-1" />
                            Download
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setShowDownloadOptions(!showDownloadOptions)}
                        >
                            Batch
                        </Button>
                    </div>
                </div>

                {/* Batch download options */}
                {showDownloadOptions && (
                    <div className="flex items-center gap-2 pt-1 border-t">
                        <Label className="text-xs">Rows</Label>
                        <Input
                            type="number"
                            min={1}
                            max={csvData.length || 1}
                            value={rangeStart}
                            onChange={(e) => setRangeStart(Math.max(1, Math.min(parseInt(e.target.value) || 1, csvData.length)))}
                            className="w-20 h-7 text-xs"
                        />
                        <span className="text-xs">to</span>
                        <Input
                            type="number"
                            min={1}
                            max={csvData.length || 1}
                            value={rangeEnd}
                            onChange={(e) => setRangeEnd(Math.max(1, Math.min(parseInt(e.target.value) || 1, csvData.length)))}
                            className="w-20 h-7 text-xs"
                        />
                        <Button onClick={downloadRange} size="sm" className="h-7 text-xs" disabled={csvData.length === 0}>
                            Download ZIP
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
