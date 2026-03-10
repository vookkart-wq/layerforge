import {
    Canvas as FabricCanvas,
    FabricImage,
    Text,
    Textbox,
    Rect,
    Circle,
    Shadow,
    Gradient,
    Group,
} from 'fabric';
import type { Layer, ImageLayer, TextLayer, CanvasConfig, CSVRow, GradientConfig, GRADIENT_PRESETS } from '../types';
import { parseTemplate } from './templateEngine';
import { proxyImageUrl } from '../lib/supabase';

// Import gradient presets
import { GRADIENT_PRESETS as PRESETS } from '../types';

/**
 * Apply text transform to a string
 */
function applyTextTransform(text: string, transform?: TextLayer['textTransform']): string {
    if (!transform || transform === 'none') return text;
    switch (transform) {
        case 'uppercase': return text.toUpperCase();
        case 'lowercase': return text.toLowerCase();
        case 'capitalize': return text.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        default: return text;
    }
}

/**
 * Unified Canvas Renderer Service
 * Single source of truth for all canvas rendering operations
 */
export class CanvasRenderer {
    private canvas: FabricCanvas;
    private config: CanvasConfig;

    constructor(canvas: FabricCanvas, config: CanvasConfig) {
        this.canvas = canvas;
        this.config = config;
    }

    /**
     * Update canvas configuration
     */
    updateConfig(config: CanvasConfig) {
        this.config = config;
        this.canvas.setDimensions({ width: config.width, height: config.height });
        this.canvas.backgroundColor = config.backgroundColor;
    }

    /**
     * Render all layers to the canvas for a specific row
     */
    async render(layers: Layer[], rowData: CSVRow): Promise<void> {
        this.canvas.clear();
        this.canvas.backgroundColor = this.config.backgroundColor;

        for (const layer of layers) {
            if (!layer.visible) continue;

            try {
                if (layer.type === 'image') {
                    await this.renderImageLayer(layer, rowData);
                } else if (layer.type === 'text') {
                    await this.renderTextLayer(layer, rowData);
                }
            } catch (error) {
                console.error('Error rendering layer:', layer.id, error);
            }
        }

        this.canvas.renderAll();
    }

    /**
     * Render an image layer
     */
    private async renderImageLayer(layer: ImageLayer, rowData: CSVRow): Promise<void> {
        let imageUrl = this.resolveSource(layer.source, rowData);
        if (!imageUrl) return;

        // Normalize URL
        imageUrl = this.normalizeUrl(imageUrl);

        // Proxy external URLs to avoid CORS
        const isExternal = /^https?:\/\//i.test(imageUrl);
        if (isExternal) {
            imageUrl = await proxyImageUrl(imageUrl);
        }

        try {
            const img = await FabricImage.fromURL(imageUrl, {
                crossOrigin: isExternal ? 'anonymous' : undefined,
            });

            img.set({
                left: layer.x,
                top: layer.y,
                originX: layer.anchor === 'center' ? 'center' : 'left',
                originY: layer.anchor === 'center' ? 'center' : 'top',
                selectable: true,
                hasControls: true,
                hasBorders: true,
                data: { layerId: layer.id },
                angle: layer.angle || 0,
            });

            // Scale to target dimensions
            if (layer.width && layer.height && img.width && img.height) {
                img.set({
                    scaleX: layer.width / img.width,
                    scaleY: layer.height / img.height,
                });
            }

            // Apply circular mask
            if (layer.mask === 'circle') {
                const targetRadius = Math.min(layer.width, layer.height) / 2;
                const scaleX = img.scaleX || 1;
                const radius = targetRadius / scaleX;
                img.clipPath = new Circle({
                    radius,
                    originX: 'center',
                    originY: 'center',
                });
            }

            img.setCoords();
            this.canvas.add(img);
        } catch (err) {
            console.error('Failed to load image:', imageUrl, err);
        }
    }

    /**
     * Render a text layer with all effects
     */
    private async renderTextLayer(layer: TextLayer, rowData: CSVRow): Promise<void> {
        let textValue = this.resolveSource(layer.source, rowData);

        // Apply text transform
        textValue = applyTextTransform(textValue, layer.textTransform);

        // Load custom font if needed
        if (layer.fontFamily && (document as any).fonts) {
            try {
                await (document as any).fonts.load(`16px ${layer.fontFamily}`);
            } catch { }
        }

        const textConfig: any = {
            left: layer.x,
            top: layer.y,
            originX: layer.anchor === 'center' ? 'center' : 'left',
            originY: layer.anchor === 'center' ? 'center' : 'top',
            fontSize: layer.fontSize,
            fontFamily: layer.fontFamily,
            fontWeight: layer.fontWeight,
            fontStyle: layer.fontStyle || 'normal',
            fill: layer.color,
            textAlign: layer.textAlign,
            selectable: true,
            hasControls: true,
            hasBorders: true,
            data: { layerId: layer.id },
            angle: layer.angle || 0,
            charSpacing: (layer.charSpacing || 0) * 10,
            lineHeight: layer.lineHeight || 1.2,
        };

        // Word spacing (Fabric.js doesn't have native support, we simulate with charSpacing on spaces)
        // This is a limitation - proper word spacing would require custom rendering

        // Stroke (outline) - new config format
        if (layer.stroke?.enabled && layer.stroke.width > 0) {
            textConfig.stroke = layer.stroke.color;
            textConfig.strokeWidth = layer.stroke.width;
        }

        // Shadow
        if (layer.shadow?.enabled) {
            textConfig.shadow = new Shadow({
                color: layer.shadow.color,
                blur: layer.shadow.blur,
                offsetX: layer.shadow.offsetX,
                offsetY: layer.shadow.offsetY,
            });
        }

        // Gradient fill
        if (layer.gradient?.enabled) {
            textConfig.fill = this.createGradient(layer.gradient);
        }

        // Create text object
        let text: Text | Textbox;

        // Handle vertical text
        if (layer.orientation === 'vertical') {
            // For vertical text, we insert newlines between each character
            const verticalText = textValue.split('').join('\n');
            textConfig.textAlign = 'center';
            text = new Text(verticalText, textConfig);
        } else if (layer.width) {
            textConfig.width = layer.width;
            text = new Textbox(textValue, textConfig);
        } else {
            text = new Text(textValue, textConfig);
        }

        // Auto-fit text to area
        if (layer.width && layer.height && layer.orientation !== 'vertical') {
            this.autoFitText(text, layer);
        }

        text.setCoords();

        // Background rectangle with padding
        if (layer.backgroundColor) {
            const padding = layer.padding || 0;
            const bgRect = new Rect({
                left: text.left!,
                top: text.top!,
                width: (text.width || 0) + padding * 2,
                height: (text.height || 0) + padding * 2,
                fill: layer.backgroundColor,
                originX: text.originX,
                originY: text.originY,
                angle: layer.angle || 0,
                selectable: false,
                evented: false,
            });
            this.canvas.add(bgRect);

            // Offset text by padding
            if (padding > 0) {
                text.set({
                    left: (text.left || 0) + (text.originX === 'center' ? 0 : padding),
                    top: (text.top || 0) + (text.originY === 'center' ? 0 : padding),
                });
            }
        }

        // Glow effect (add a blurred copy behind)
        if (layer.glow?.enabled && layer.glow.blur > 0) {
            const glowText = await text.clone() as Text;
            glowText.set({
                fill: layer.glow.color,
                stroke: layer.glow.color,
                strokeWidth: layer.glow.spread,
                shadow: new Shadow({
                    color: layer.glow.color,
                    blur: layer.glow.blur,
                    offsetX: 0,
                    offsetY: 0,
                }),
                selectable: false,
                evented: false,
            });
            this.canvas.add(glowText);
        }

        // Emboss/3D effect (add offset shadows for depth)
        if (layer.emboss?.enabled) {
            const depth = layer.emboss.depth || 2;
            const isRaised = layer.emboss.type === 'raised';

            // Light side
            const lightText = await text.clone() as Text;
            lightText.set({
                left: (text.left || 0) + (isRaised ? -1 : 1),
                top: (text.top || 0) + (isRaised ? -1 : 1),
                fill: layer.emboss.lightColor,
                selectable: false,
                evented: false,
            });
            this.canvas.add(lightText);

            // Shadow side
            const shadowText = await text.clone() as Text;
            shadowText.set({
                left: (text.left || 0) + (isRaised ? depth : -depth),
                top: (text.top || 0) + (isRaised ? depth : -depth),
                fill: layer.emboss.shadowColor,
                selectable: false,
                evented: false,
            });
            this.canvas.add(shadowText);
        }

        this.canvas.add(text);
    }

    /**
     * Auto-fit text size to fit within bounds
     */
    private autoFitText(text: Text | Textbox, layer: TextLayer): void {
        if (!layer.autoFit || !layer.width || !layer.height) return;

        let size = layer.fontSize || 16;
        let guard = 200;

        // Grow until overflow
        while (guard-- > 0) {
            text.set({ fontSize: size + 1 });
            const w = text.width || 0;
            const h = text.height || 0;
            if (w > layer.width || h > layer.height) break;
            size++;
        }

        // Shrink to fit
        while ((text.width || 0) > layer.width || (text.height || 0) > layer.height) {
            size--;
            if (size <= 6) break;
            text.set({ fontSize: size });
        }
    }

    /**
     * Create gradient fill with multi-stop support
     */
    private createGradient(gradient: GradientConfig): Gradient<'linear' | 'radial'> {
        // Get color stops - use preset if specified, otherwise use custom stops
        let colorStops = gradient.stops;
        if (gradient.preset && PRESETS[gradient.preset]) {
            colorStops = PRESETS[gradient.preset];
        }

        // Ensure we have at least 2 stops
        if (!colorStops || colorStops.length < 2) {
            colorStops = [
                { offset: 0, color: '#000000' },
                { offset: 1, color: '#ffffff' },
            ];
        }

        if (gradient.type === 'radial') {
            return new Gradient({
                type: 'radial',
                coords: {
                    x1: 0.5,
                    y1: 0.5,
                    x2: 0.5,
                    y2: 0.5,
                    r1: 0,
                    r2: 0.5,
                },
                gradientUnits: 'percentage',
                colorStops: colorStops.map(s => ({ offset: s.offset, color: s.color })),
            });
        }

        const angleRad = (gradient.angle || 0) * (Math.PI / 180);
        const x2 = Math.cos(angleRad);
        const y2 = Math.sin(angleRad);

        return new Gradient({
            type: 'linear',
            coords: {
                x1: 0.5 - x2 / 2,
                y1: 0.5 - y2 / 2,
                x2: 0.5 + x2 / 2,
                y2: 0.5 + y2 / 2,
            },
            gradientUnits: 'percentage',
            colorStops: colorStops.map(s => ({ offset: s.offset, color: s.color })),
        });
    }

    /**
     * Resolve layer source to actual value
     */
    private resolveSource(source: Layer['source'], rowData: CSVRow): string {
        switch (source.type) {
            case 'csv':
                return rowData[source.column] || '';
            case 'static':
                return source.value;
            case 'upload':
                return source.url;
            case 'template':
                return parseTemplate(source.template, rowData);
            default:
                return '';
        }
    }

    /**
     * Normalize URL (handle spaces, protocol-relative URLs)
     */
    private normalizeUrl(url: string): string {
        let normalized = url.trim();

        if (normalized.startsWith('data:') || normalized.startsWith('blob:')) {
            return normalized;
        }

        normalized = normalized.replace(/\s/g, '%20');
        if (normalized.startsWith('//')) {
            normalized = `https:${normalized}`;
        }

        return normalized;
    }

    /**
     * Export canvas to data URL
     */
    toDataURL(format: 'png' | 'jpeg' | 'webp', quality: number, multiplier: number): string {
        return this.canvas.toDataURL({
            format,
            quality: quality / 100,
            multiplier,
        });
    }

    /**
     * Get the Fabric canvas instance
     */
    getCanvas(): FabricCanvas {
        return this.canvas;
    }
}

/**
 * Create a new CanvasRenderer with a temporary canvas
 * Useful for batch rendering without affecting the UI
 */
export function createOffscreenRenderer(config: CanvasConfig): CanvasRenderer {
    const canvas = new FabricCanvas(undefined, {
        width: config.width,
        height: config.height,
        backgroundColor: config.backgroundColor,
    });
    return new CanvasRenderer(canvas, config);
}
