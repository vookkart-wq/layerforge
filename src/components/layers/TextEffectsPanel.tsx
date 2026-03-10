import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
    ShadowConfig,
    GlowConfig,
    StrokeConfig,
    EmbossConfig,
    GradientConfig,
    GRADIENT_PRESETS,
    TextTransform,
    TextOrientation
} from '@/types';

interface TextEffectsPanelProps {
    shadow?: ShadowConfig;
    glow?: GlowConfig;
    stroke?: StrokeConfig;
    emboss?: EmbossConfig;
    gradient?: GradientConfig;
    textTransform?: TextTransform;
    orientation?: TextOrientation;
    charSpacing?: number;
    lineHeight?: number;
    onUpdate: (updates: Partial<{
        shadow: ShadowConfig;
        glow: GlowConfig;
        stroke: StrokeConfig;
        emboss: EmbossConfig;
        gradient: GradientConfig;
        textTransform: TextTransform;
        orientation: TextOrientation;
        charSpacing: number;
        lineHeight: number;
    }>) => void;
}

export function TextEffectsPanel({
    shadow,
    glow,
    stroke,
    emboss,
    gradient,
    textTransform,
    orientation,
    charSpacing,
    lineHeight,
    onUpdate,
}: TextEffectsPanelProps) {
    const defaultShadow: ShadowConfig = { enabled: false, color: '#000000', blur: 10, offsetX: 4, offsetY: 4 };
    const defaultGlow: GlowConfig = { enabled: false, color: '#00ff00', blur: 15, spread: 3 };
    const defaultStroke: StrokeConfig = { enabled: false, color: '#000000', width: 2 };
    const defaultEmboss: EmbossConfig = { enabled: false, type: 'raised', depth: 2, lightColor: '#ffffff', shadowColor: '#000000' };
    const defaultGradient: GradientConfig = {
        enabled: false,
        type: 'linear',
        angle: 90,
        stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }],
        preset: undefined
    };

    const currentShadow = shadow || defaultShadow;
    const currentGlow = glow || defaultGlow;
    const currentStroke = stroke || defaultStroke;
    const currentEmboss = emboss || defaultEmboss;
    const currentGradient = gradient || defaultGradient;

    return (
        <div className="space-y-6">
            {/* Typography Controls */}
            <div className="space-y-4 border-b pb-4">
                <Label className="text-sm font-semibold">Typography</Label>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Letter Spacing</Label>
                        <Input
                            type="number"
                            step={0.1}
                            value={charSpacing || 0}
                            onChange={(e) => onUpdate({ charSpacing: parseFloat(e.target.value) || 0 })}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Line Height</Label>
                        <Input
                            type="number"
                            step={0.1}
                            min={0.5}
                            max={3}
                            value={lineHeight || 1.2}
                            onChange={(e) => onUpdate({ lineHeight: parseFloat(e.target.value) || 1.2 })}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Text Transform</Label>
                        <Select
                            value={textTransform || 'none'}
                            onValueChange={(v: TextTransform) => onUpdate({ textTransform: v })}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                <SelectItem value="uppercase">UPPERCASE</SelectItem>
                                <SelectItem value="lowercase">lowercase</SelectItem>
                                <SelectItem value="capitalize">Capitalize</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Orientation</Label>
                        <Select
                            value={orientation || 'horizontal'}
                            onValueChange={(v: TextOrientation) => onUpdate({ orientation: v })}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="horizontal">Horizontal</SelectItem>
                                <SelectItem value="vertical">Vertical</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            {/* Drop Shadow */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">Drop Shadow</Label>
                    <Switch
                        checked={currentShadow.enabled}
                        onCheckedChange={(checked) => onUpdate({ shadow: { ...currentShadow, enabled: checked } })}
                    />
                </div>
                {currentShadow.enabled && (
                    <div className="grid grid-cols-2 gap-3 pl-2 border-l-2 border-primary/20">
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Color</Label>
                            <Input
                                type="color"
                                value={currentShadow.color}
                                onChange={(e) => onUpdate({ shadow: { ...currentShadow, color: e.target.value } })}
                                className="h-8 w-full"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Blur</Label>
                            <Input
                                type="number"
                                min={0}
                                max={50}
                                value={currentShadow.blur}
                                onChange={(e) => onUpdate({ shadow: { ...currentShadow, blur: parseInt(e.target.value) || 0 } })}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Offset X</Label>
                            <Input
                                type="number"
                                value={currentShadow.offsetX}
                                onChange={(e) => onUpdate({ shadow: { ...currentShadow, offsetX: parseInt(e.target.value) || 0 } })}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Offset Y</Label>
                            <Input
                                type="number"
                                value={currentShadow.offsetY}
                                onChange={(e) => onUpdate({ shadow: { ...currentShadow, offsetY: parseInt(e.target.value) || 0 } })}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Glow Effect */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">Glow Effect</Label>
                    <Switch
                        checked={currentGlow.enabled}
                        onCheckedChange={(checked) => onUpdate({ glow: { ...currentGlow, enabled: checked } })}
                    />
                </div>
                {currentGlow.enabled && (
                    <div className="grid grid-cols-3 gap-3 pl-2 border-l-2 border-primary/20">
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Color</Label>
                            <Input
                                type="color"
                                value={currentGlow.color}
                                onChange={(e) => onUpdate({ glow: { ...currentGlow, color: e.target.value } })}
                                className="h-8 w-full"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Blur</Label>
                            <Input
                                type="number"
                                min={0}
                                max={50}
                                value={currentGlow.blur}
                                onChange={(e) => onUpdate({ glow: { ...currentGlow, blur: parseInt(e.target.value) || 0 } })}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Spread</Label>
                            <Input
                                type="number"
                                min={0}
                                max={20}
                                value={currentGlow.spread}
                                onChange={(e) => onUpdate({ glow: { ...currentGlow, spread: parseInt(e.target.value) || 0 } })}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Stroke/Outline */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">Outline/Stroke</Label>
                    <Switch
                        checked={currentStroke.enabled}
                        onCheckedChange={(checked) => onUpdate({ stroke: { ...currentStroke, enabled: checked } })}
                    />
                </div>
                {currentStroke.enabled && (
                    <div className="grid grid-cols-2 gap-3 pl-2 border-l-2 border-primary/20">
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Color</Label>
                            <Input
                                type="color"
                                value={currentStroke.color}
                                onChange={(e) => onUpdate({ stroke: { ...currentStroke, color: e.target.value } })}
                                className="h-8 w-full"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Width</Label>
                            <Input
                                type="number"
                                min={0}
                                max={20}
                                value={currentStroke.width}
                                onChange={(e) => onUpdate({ stroke: { ...currentStroke, width: parseInt(e.target.value) || 0 } })}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* 3D/Emboss */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">3D / Emboss</Label>
                    <Switch
                        checked={currentEmboss.enabled}
                        onCheckedChange={(checked) => onUpdate({ emboss: { ...currentEmboss, enabled: checked } })}
                    />
                </div>
                {currentEmboss.enabled && (
                    <div className="space-y-3 pl-2 border-l-2 border-primary/20">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Effect</Label>
                                <Select
                                    value={currentEmboss.type}
                                    onValueChange={(v: 'raised' | 'sunken') => onUpdate({ emboss: { ...currentEmboss, type: v } })}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="raised">Raised</SelectItem>
                                        <SelectItem value="sunken">Sunken</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Depth</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    max={10}
                                    value={currentEmboss.depth}
                                    onChange={(e) => onUpdate({ emboss: { ...currentEmboss, depth: parseInt(e.target.value) || 2 } })}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Light Color</Label>
                                <Input
                                    type="color"
                                    value={currentEmboss.lightColor}
                                    onChange={(e) => onUpdate({ emboss: { ...currentEmboss, lightColor: e.target.value } })}
                                    className="h-8 w-full"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Shadow Color</Label>
                                <Input
                                    type="color"
                                    value={currentEmboss.shadowColor}
                                    onChange={(e) => onUpdate({ emboss: { ...currentEmboss, shadowColor: e.target.value } })}
                                    className="h-8 w-full"
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Gradient */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">Gradient Fill</Label>
                    <Switch
                        checked={currentGradient.enabled}
                        onCheckedChange={(checked) => onUpdate({ gradient: { ...currentGradient, enabled: checked } })}
                    />
                </div>
                {currentGradient.enabled && (
                    <div className="space-y-3 pl-2 border-l-2 border-primary/20">
                        {/* Presets */}
                        <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Preset</Label>
                            <div className="flex flex-wrap gap-2">
                                {Object.keys(GRADIENT_PRESETS).map((preset) => (
                                    <Button
                                        key={preset}
                                        type="button"
                                        size="sm"
                                        variant={currentGradient.preset === preset ? 'default' : 'outline'}
                                        onClick={() => onUpdate({
                                            gradient: {
                                                ...currentGradient,
                                                preset,
                                                stops: GRADIENT_PRESETS[preset]
                                            }
                                        })}
                                        className="h-7 text-xs capitalize"
                                        style={{
                                            background: currentGradient.preset === preset
                                                ? undefined
                                                : `linear-gradient(90deg, ${GRADIENT_PRESETS[preset].map(s => s.color).join(', ')})`,
                                            color: currentGradient.preset === preset ? undefined : '#fff',
                                            textShadow: currentGradient.preset === preset ? undefined : '0 1px 2px rgba(0,0,0,0.5)',
                                        }}
                                    >
                                        {preset}
                                    </Button>
                                ))}
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={!currentGradient.preset ? 'default' : 'outline'}
                                    onClick={() => onUpdate({ gradient: { ...currentGradient, preset: undefined } })}
                                    className="h-7 text-xs"
                                >
                                    Custom
                                </Button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Type</Label>
                                <Select
                                    value={currentGradient.type}
                                    onValueChange={(v: 'linear' | 'radial') => onUpdate({ gradient: { ...currentGradient, type: v } })}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="linear">Linear</SelectItem>
                                        <SelectItem value="radial">Radial</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {currentGradient.type === 'linear' && (
                                <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Angle ({currentGradient.angle}°)</Label>
                                    <Input
                                        type="range"
                                        min={0}
                                        max={360}
                                        value={currentGradient.angle}
                                        onChange={(e) => onUpdate({ gradient: { ...currentGradient, angle: parseInt(e.target.value) } })}
                                    />
                                </div>
                            )}
                        </div>

                        {/* Custom color stops */}
                        {!currentGradient.preset && (
                            <div className="space-y-2">
                                <Label className="text-xs text-muted-foreground">Colors (click to edit)</Label>
                                <div className="flex gap-2">
                                    {(currentGradient.stops || []).map((stop, i) => (
                                        <Input
                                            key={i}
                                            type="color"
                                            value={stop.color}
                                            onChange={(e) => {
                                                const newStops = [...(currentGradient.stops || [])];
                                                newStops[i] = { ...newStops[i], color: e.target.value };
                                                onUpdate({ gradient: { ...currentGradient, stops: newStops } });
                                            }}
                                            className="h-8 w-10 p-0.5"
                                        />
                                    ))}
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            const stops = currentGradient.stops || [];
                                            const newOffset = stops.length > 0 ? 1 : 0;
                                            onUpdate({
                                                gradient: {
                                                    ...currentGradient,
                                                    stops: [...stops, { offset: newOffset, color: '#888888' }]
                                                }
                                            });
                                        }}
                                        className="h-8 w-8 p-0"
                                    >
                                        +
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
