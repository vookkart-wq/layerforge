import { useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Type, Sparkles } from 'lucide-react';
import { useLayerStore } from '@/stores/useLayerStore';
import { useCSVStore } from '@/stores/useCSVStore';
import { useFontStore } from '@/stores/useFontStore';
import { TextEffectsPanel } from './TextEffectsPanel';
import { ImageLayer, TextLayer } from '@/types';

const FONTS = [
    'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Verdana',
    'Trebuchet MS', 'Courier New', 'Impact', 'Comic Sans MS',
    'Inter', 'Roboto', 'Open Sans', 'Montserrat', 'Poppins'
];

export function LayerProperties() {
    const { layers, selectedLayerId, updateLayer } = useLayerStore();
    const { headers: csvHeaders } = useCSVStore();
    const { customFonts } = useFontStore();

    const layer = layers.find((l) => l.id === selectedLayerId);

    if (!layer) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Properties</CardTitle>
                    <CardDescription>Select a layer to edit its properties</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground text-center py-8">
                        Click on a layer in the list to edit it
                    </p>
                </CardContent>
            </Card>
        );
    }

    const updateField = (field: string, value: any) => {
        updateLayer(layer.id, { [field]: value });
    };

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle>
                    {layer.type === 'image' ? '🖼️ Image' : '🔤 Text'} Properties
                </CardTitle>
                <CardDescription>Edit layer settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Position */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label className="text-xs">X Position</Label>
                        <Input
                            type="number"
                            value={layer.x}
                            onChange={(e) => updateField('x', parseInt(e.target.value) || 0)}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs">Y Position</Label>
                        <Input
                            type="number"
                            value={layer.y}
                            onChange={(e) => updateField('y', parseInt(e.target.value) || 0)}
                        />
                    </div>
                </div>

                {/* Rotation */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label className="text-xs">Rotation</Label>
                        <span className="text-xs text-muted-foreground">{layer.angle || 0}°</span>
                    </div>
                    <Input
                        type="range"
                        min={-180}
                        max={180}
                        value={layer.angle || 0}
                        onChange={(e) => updateField('angle', parseInt(e.target.value))}
                    />
                </div>

                {/* Image-specific properties */}
                {layer.type === 'image' && (
                    <ImageProperties layer={layer} updateField={updateField} csvHeaders={csvHeaders} />
                )}

                {/* Text-specific properties */}
                {layer.type === 'text' && (
                    <TextProperties layer={layer} updateField={updateField} csvHeaders={csvHeaders} customFonts={customFonts} />
                )}
            </CardContent>
        </Card>
    );
}

function ImageProperties({ layer, updateField, csvHeaders }: {
    layer: ImageLayer;
    updateField: (field: string, value: any) => void;
    csvHeaders: string[];
}) {
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const base64 = event.target?.result as string;
            updateField('source', { type: 'static', value: base64 });
        };
        reader.readAsDataURL(file);
    };

    const getSourceType = () => {
        if (layer.source.type === 'csv') return 'csv';
        if (layer.source.type === 'static') return 'static';
        return 'csv';
    };

    return (
        <>
            {/* Source Type Editor */}
            <div className="space-y-3 pb-3 border-b">
                <Label className="text-xs font-medium">Image Source</Label>
                <Tabs value={getSourceType()} onValueChange={(v) => {
                    if (v === 'csv') {
                        updateField('source', { type: 'csv', column: csvHeaders[0] || '' });
                    } else {
                        updateField('source', { type: 'static', value: '' });
                    }
                }}>
                    <TabsList className="grid w-full grid-cols-2 h-8">
                        <TabsTrigger value="csv" className="text-xs">From CSV</TabsTrigger>
                        <TabsTrigger value="static" className="text-xs">Static/Upload</TabsTrigger>
                    </TabsList>

                    <TabsContent value="csv" className="pt-2">
                        <Select
                            value={layer.source.type === 'csv' ? layer.source.column : ''}
                            onValueChange={(v) => updateField('source', { type: 'csv', column: v })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select column" />
                            </SelectTrigger>
                            <SelectContent>
                                {csvHeaders.map((header) => (
                                    <SelectItem key={header} value={header}>{header}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </TabsContent>

                    <TabsContent value="static" className="pt-2 space-y-2">
                        <Input
                            type="text"
                            value={layer.source.type === 'static' ? (layer.source.value?.startsWith('data:') ? '(Uploaded image)' : layer.source.value) : ''}
                            onChange={(e) => updateField('source', { type: 'static', value: e.target.value })}
                            placeholder="Image URL"
                            disabled={layer.source.type === 'static' && layer.source.value?.startsWith('data:')}
                        />
                        <div className="flex gap-2">
                            <Input type="file" accept="image/*" onChange={handleFileUpload} className="text-xs" />
                        </div>
                        {layer.source.type === 'static' && layer.source.value?.startsWith('data:') && (
                            <img src={layer.source.value} alt="Preview" className="max-w-full h-16 object-contain rounded border" />
                        )}
                    </TabsContent>
                </Tabs>
            </div>

            {/* Dimensions */}
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label className="text-xs">Width</Label>
                    <Input
                        type="number"
                        value={layer.width}
                        onChange={(e) => updateField('width', parseInt(e.target.value) || 400)}
                    />
                </div>
                <div className="space-y-2">
                    <Label className="text-xs">Height</Label>
                    <Input
                        type="number"
                        value={layer.height}
                        onChange={(e) => updateField('height', parseInt(e.target.value) || 400)}
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label className="text-xs">Mask Shape</Label>
                <Select value={layer.mask || 'none'} onValueChange={(v: 'none' | 'circle') => updateField('mask', v)}>
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">None (Rectangle)</SelectItem>
                        <SelectItem value="circle">Circle</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </>
    );
}

function TextProperties({ layer, updateField, csvHeaders, customFonts }: {
    layer: TextLayer;
    updateField: (field: string, value: any) => void;
    csvHeaders: string[];
    customFonts: string[];
}) {
    return (
        <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="basic" className="text-xs">
                    <Type className="w-3 h-3 mr-1" />
                    Basic
                </TabsTrigger>
                <TabsTrigger value="effects" className="text-xs">
                    <Sparkles className="w-3 h-3 mr-1" />
                    Effects
                </TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4 pt-3">
                {/* Source Type Editor */}
                <div className="space-y-3 pb-3 border-b">
                    <Label className="text-xs font-medium">Text Source</Label>
                    <Tabs
                        value={layer.source.type}
                        onValueChange={(v) => {
                            if (v === 'csv') {
                                updateField('source', { type: 'csv', column: csvHeaders[0] || '' });
                            } else if (v === 'template') {
                                updateField('source', { type: 'template', template: '' });
                            } else {
                                updateField('source', { type: 'static', value: '' });
                            }
                        }}
                    >
                        <TabsList className="grid w-full grid-cols-3 h-8">
                            <TabsTrigger value="csv" className="text-xs">CSV</TabsTrigger>
                            <TabsTrigger value="template" className="text-xs">Template</TabsTrigger>
                            <TabsTrigger value="static" className="text-xs">Static</TabsTrigger>
                        </TabsList>

                        <TabsContent value="csv" className="pt-2">
                            <Select
                                value={layer.source.type === 'csv' ? layer.source.column : ''}
                                onValueChange={(v) => updateField('source', { type: 'csv', column: v })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select column" />
                                </SelectTrigger>
                                <SelectContent>
                                    {csvHeaders.map((header) => (
                                        <SelectItem key={header} value={header}>{header}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </TabsContent>

                        <TabsContent value="template" className="pt-2">
                            <TemplateEditor
                                layer={layer}
                                updateField={updateField}
                                csvHeaders={csvHeaders}
                            />
                        </TabsContent>

                        <TabsContent value="static" className="pt-2">
                            <Textarea
                                value={layer.source.type === 'static' ? layer.source.value : ''}
                                onChange={(e) => updateField('source', { type: 'static', value: e.target.value })}
                                rows={3}
                                placeholder="Enter static text..."
                                className="resize-y min-h-[80px] text-sm"
                            />
                        </TabsContent>
                    </Tabs>
                </div>

                {/* Font settings */}
                <div className="space-y-2">
                    <Label className="text-xs">Font Family</Label>
                    <Select value={layer.fontFamily} onValueChange={(v) => updateField('fontFamily', v)}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {customFonts.length > 0 && (
                                <>
                                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Custom Fonts</div>
                                    {customFonts.map((font) => (
                                        <SelectItem key={font} value={font} style={{ fontFamily: font }}>
                                            {font}
                                        </SelectItem>
                                    ))}
                                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t mt-1 pt-2">System Fonts</div>
                                </>
                            )}
                            {FONTS.map((font) => (
                                <SelectItem key={font} value={font} style={{ fontFamily: font }}>
                                    {font}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label className="text-xs">Font Size</Label>
                        <Input
                            type="number"
                            value={layer.fontSize}
                            onChange={(e) => updateField('fontSize', parseInt(e.target.value) || 32)}
                            disabled={layer.autoFit}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs">Alignment</Label>
                        <Select value={layer.textAlign} onValueChange={(v: 'left' | 'center' | 'right') => updateField('textAlign', v)}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="left">Left</SelectItem>
                                <SelectItem value="center">Center</SelectItem>
                                <SelectItem value="right">Right</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Font Weight & Style */}
                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-xs">
                        <input
                            type="checkbox"
                            checked={layer.fontWeight === 'bold'}
                            onChange={(e) => updateField('fontWeight', e.target.checked ? 'bold' : 'normal')}
                            className="rounded"
                        />
                        <span className="font-bold">Bold</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                        <input
                            type="checkbox"
                            checked={layer.fontStyle === 'italic'}
                            onChange={(e) => updateField('fontStyle', e.target.checked ? 'italic' : 'normal')}
                            className="rounded"
                        />
                        <span className="italic">Italic</span>
                    </label>
                </div>

                <div className="space-y-2">
                    <Label className="text-xs">Text Color</Label>
                    <div className="flex gap-2">
                        <Input
                            type="color"
                            value={layer.color}
                            onChange={(e) => updateField('color', e.target.value)}
                            className="w-12 h-9 p-1 cursor-pointer"
                        />
                        <Input
                            type="text"
                            value={layer.color}
                            onChange={(e) => updateField('color', e.target.value)}
                            className="flex-1 font-mono text-xs"
                        />
                    </div>
                </div>

                {/* Text dimensions for autofit */}
                <div className="flex items-center gap-2 pt-2">
                    <Switch
                        checked={layer.autoFit || false}
                        onCheckedChange={(checked) => updateField('autoFit', checked)}
                    />
                    <Label className="text-xs">Auto-fit to area</Label>
                </div>

                {layer.autoFit && (
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-xs">Max Width</Label>
                            <Input
                                type="number"
                                value={layer.width || 0}
                                onChange={(e) => updateField('width', parseInt(e.target.value) || 0)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs">Max Height</Label>
                            <Input
                                type="number"
                                value={layer.height || 0}
                                onChange={(e) => updateField('height', parseInt(e.target.value) || 0)}
                            />
                        </div>
                    </div>
                )}

                {/* Background */}
                <div className="pt-3 border-t space-y-3">
                    <Label className="text-xs font-medium">Background</Label>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Color</Label>
                            <div className="flex gap-2 items-center">
                                <Input
                                    type="color"
                                    value={layer.backgroundColor || '#ffffff'}
                                    onChange={(e) => updateField('backgroundColor', e.target.value)}
                                    className="w-8 h-7 p-0.5 cursor-pointer"
                                    disabled={!layer.backgroundColor}
                                />
                                <label className="flex items-center gap-1 text-xs">
                                    <input
                                        type="checkbox"
                                        checked={!layer.backgroundColor}
                                        onChange={(e) => updateField('backgroundColor', e.target.checked ? undefined : '#ffffff')}
                                    />
                                    None
                                </label>
                            </div>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Padding</Label>
                            <Input
                                type="number"
                                min={0}
                                max={50}
                                value={layer.padding || 0}
                                onChange={(e) => updateField('padding', parseInt(e.target.value) || 0)}
                                disabled={!layer.backgroundColor}
                            />
                        </div>
                    </div>
                </div>
            </TabsContent>

            {/* Effects Tab */}
            <TabsContent value="effects" className="pt-3">
                <TextEffectsPanel
                    shadow={layer.shadow}
                    glow={layer.glow}
                    stroke={layer.stroke}
                    emboss={layer.emboss}
                    gradient={layer.gradient}
                    textTransform={layer.textTransform}
                    orientation={layer.orientation}
                    charSpacing={layer.charSpacing}
                    lineHeight={layer.lineHeight}
                    onUpdate={(updates) => {
                        Object.entries(updates).forEach(([key, value]) => {
                            updateField(key, value);
                        });
                    }}
                />
            </TabsContent>
        </Tabs>
    );
}

// Template editor with clickable column badges
function TemplateEditor({ layer, updateField, csvHeaders }: {
    layer: TextLayer;
    updateField: (field: string, value: any) => void;
    csvHeaders: string[];
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const insertColumnVariable = (column: string) => {
        const variable = `{{${column}}}`;
        const textarea = textareaRef.current;
        const currentTemplate = layer.source.type === 'template' ? layer.source.template : '';

        if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const newValue = currentTemplate.slice(0, start) + variable + currentTemplate.slice(end);
            updateField('source', { type: 'template', template: newValue });

            // Restore cursor position
            setTimeout(() => {
                textarea.focus();
                const newPos = start + variable.length;
                textarea.setSelectionRange(newPos, newPos);
            }, 0);
        } else {
            updateField('source', { type: 'template', template: currentTemplate + variable });
        }
    };

    return (
        <div className="space-y-2">
            <Label className="text-xs">Template</Label>
            <Textarea
                ref={textareaRef}
                value={layer.source.type === 'template' ? layer.source.template : ''}
                onChange={(e) => updateField('source', { type: 'template', template: e.target.value })}
                rows={3}
                className="resize-y min-h-[80px] text-sm"
            />
            <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Click to insert:</p>
                <div className="flex flex-wrap gap-1">
                    {csvHeaders.map((header) => (
                        <button
                            key={header}
                            type="button"
                            onClick={() => insertColumnVariable(header)}
                            className="px-2 py-0.5 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded border border-primary/20 transition-colors cursor-pointer"
                        >
                            {`{{${header}}}`}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
