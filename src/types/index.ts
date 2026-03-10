// Layer Types
export type LayerType = 'image' | 'text';

export type LayerSource =
    | { type: 'csv'; column: string }
    | { type: 'static'; value: string }
    | { type: 'upload'; url: string }
    | { type: 'template'; template: string };

// Shadow configuration for drop shadows
export interface ShadowConfig {
    enabled: boolean;
    color: string;
    blur: number;
    offsetX: number;
    offsetY: number;
}

// Glow effect configuration
export interface GlowConfig {
    enabled: boolean;
    color: string;
    blur: number;
    spread: number;
}

// Stroke/Outline configuration
export interface StrokeConfig {
    enabled: boolean;
    color: string;
    width: number;
}

// 3D/Emboss effect configuration
export interface EmbossConfig {
    enabled: boolean;
    type: 'raised' | 'sunken';
    depth: number;
    lightColor: string;
    shadowColor: string;
}

// Gradient stop for multi-color gradients
export interface GradientStop {
    offset: number; // 0-1
    color: string;
}

// Gradient configuration with multi-stop support
export interface GradientConfig {
    enabled: boolean;
    type: 'linear' | 'radial';
    angle: number; // For linear gradients
    stops: GradientStop[];
    preset?: string; // e.g., 'gold', 'silver', 'rainbow'
}

// Text transform options
export type TextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize';

// Text orientation
export type TextOrientation = 'horizontal' | 'vertical';

export interface BaseLayer {
    id: string;
    type: LayerType;
    x: number;
    y: number;
    visible: boolean;
    anchor?: 'top-left' | 'center';
    angle?: number;
}

export interface ImageLayer extends BaseLayer {
    type: 'image';
    source: LayerSource;
    width: number;
    height: number;
    mask?: 'none' | 'circle';
}

export interface TextLayer extends BaseLayer {
    type: 'text';
    source: LayerSource;
    fontSize: number;
    fontFamily: string;
    fontWeight: string;
    fontStyle?: 'normal' | 'italic';
    color: string;
    textAlign: 'left' | 'center' | 'right';
    width?: number;
    height?: number;
    autoFit?: boolean;

    // Typography
    charSpacing?: number;
    lineHeight?: number;
    wordSpacing?: number;
    textTransform?: TextTransform;
    orientation?: TextOrientation;

    // Background
    backgroundColor?: string;
    padding?: number;

    // Effects
    shadow?: ShadowConfig;
    glow?: GlowConfig;
    stroke?: StrokeConfig;
    emboss?: EmbossConfig;
    gradient?: GradientConfig;

    // Curved text (advanced)
    curveRadius?: number; // 0 = no curve, positive = curve up, negative = curve down
}

export type Layer = ImageLayer | TextLayer;

// Canvas Configuration
export interface CanvasConfig {
    width: number;
    height: number;
    backgroundColor: string;
    maintainRatio?: boolean;
    aspectRatio?: number; // stored when maintainRatio is enabled
}

// Output Configuration  
export interface OutputConfig {
    width: number;
    height: number;
    format: 'png' | 'jpeg' | 'webp';
    quality: number;
    maintainRatio?: boolean;
    aspectRatio?: number; // stored when maintainRatio is enabled
}

// CSV Row Data
export type CSVRow = Record<string, string>;

// Upload Status for Cloudinary
export interface UploadStatus {
    name: string;
    status: 'pending' | 'uploading' | 'success' | 'error';
    url?: string;
    error?: string;
}

// Gradient Presets
export const GRADIENT_PRESETS: Record<string, GradientStop[]> = {
    gold: [
        { offset: 0, color: '#BF953F' },
        { offset: 0.5, color: '#FCF6BA' },
        { offset: 1, color: '#B38728' },
    ],
    silver: [
        { offset: 0, color: '#C0C0C0' },
        { offset: 0.5, color: '#FFFFFF' },
        { offset: 1, color: '#808080' },
    ],
    rainbow: [
        { offset: 0, color: '#FF0000' },
        { offset: 0.17, color: '#FF7F00' },
        { offset: 0.33, color: '#FFFF00' },
        { offset: 0.5, color: '#00FF00' },
        { offset: 0.67, color: '#0000FF' },
        { offset: 0.83, color: '#4B0082' },
        { offset: 1, color: '#9400D3' },
    ],
    sunset: [
        { offset: 0, color: '#FF512F' },
        { offset: 1, color: '#F09819' },
    ],
    ocean: [
        { offset: 0, color: '#2193b0' },
        { offset: 1, color: '#6dd5ed' },
    ],
    purple: [
        { offset: 0, color: '#667eea' },
        { offset: 1, color: '#764ba2' },
    ],
    fire: [
        { offset: 0, color: '#f12711' },
        { offset: 0.5, color: '#f5af19' },
        { offset: 1, color: '#f12711' },
    ],
    neon: [
        { offset: 0, color: '#00ff87' },
        { offset: 0.5, color: '#60efff' },
        { offset: 1, color: '#00ff87' },
    ],
};
