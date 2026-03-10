import { useState, useRef } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Upload, Trash2, Type, Sparkles } from 'lucide-react';
import { useLayerStore } from '@/stores/useLayerStore';
import { useCSVStore } from '@/stores/useCSVStore';
import { useFontStore } from '@/stores/useFontStore';
import { TextEffectsPanel } from './TextEffectsPanel';
import { Layer, LayerType, ShadowConfig, GlowConfig, StrokeConfig, EmbossConfig, GradientConfig, TextTransform, TextOrientation } from '@/types';
import { toast } from 'sonner';

const FONTS = [
    'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Verdana',
    'Trebuchet MS', 'Courier New', 'Impact', 'Comic Sans MS',
    'Inter', 'Roboto', 'Open Sans', 'Montserrat', 'Poppins'
];

interface AddLayerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function AddLayerDialog({ open, onOpenChange }: AddLayerDialogProps) {
    const { headers: csvHeaders } = useCSVStore();
    const addLayer = useLayerStore((s) => s.addLayer);
    const { customFonts, uploadFont, removeFont } = useFontStore();
    const fontInputRef = useRef<HTMLInputElement>(null);
    const templateTextareaRef = useRef<HTMLTextAreaElement>(null);

    const [layerType, setLayerType] = useState<LayerType>('image');
    const [sourceType, setSourceType] = useState<'csv' | 'static' | 'upload' | 'template'>('csv');
    const [selectedColumn, setSelectedColumn] = useState(csvHeaders[0] || '');
    const [staticValue, setStaticValue] = useState('');
    const [templateValue, setTemplateValue] = useState('');
    const [uploadedFile, setUploadedFile] = useState('');
    const [autoDetectedDimensions, setAutoDetectedDimensions] = useState(false);

    // Function to insert column variable at cursor position
    const insertColumnVariable = (column: string) => {
        const variable = `{{${column}}}`;
        const textarea = templateTextareaRef.current;

        if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const newValue = templateValue.slice(0, start) + variable + templateValue.slice(end);
            setTemplateValue(newValue);

            // Restore cursor position after the inserted variable
            setTimeout(() => {
                textarea.focus();
                const newPos = start + variable.length;
                textarea.setSelectionRange(newPos, newPos);
            }, 0);
        } else {
            // Fallback: append to end
            setTemplateValue(templateValue + variable);
        }
    };

    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [dimensions, setDimensions] = useState({ width: 400, height: 400 });
    const [imageMask, setImageMask] = useState<'none' | 'circle'>('none');

    // Basic text style
    const [textStyle, setTextStyle] = useState({
        fontSize: 32,
        fontFamily: 'Arial',
        fontWeight: 'normal',
        fontStyle: 'normal' as 'normal' | 'italic',
        color: '#000000',
        textAlign: 'left' as 'left' | 'center' | 'right',
        width: 0,
        height: 0,
        autoFit: false,
        backgroundColor: '',
        padding: 0,
    });

    // Text effects
    const [textEffects, setTextEffects] = useState<{
        shadow?: ShadowConfig;
        glow?: GlowConfig;
        stroke?: StrokeConfig;
        emboss?: EmbossConfig;
        gradient?: GradientConfig;
        textTransform?: TextTransform;
        orientation?: TextOrientation;
        charSpacing?: number;
        lineHeight?: number;
    }>({});

    const resetForm = () => {
        setLayerType('image');
        setSourceType('csv');
        setSelectedColumn(csvHeaders[0] || '');
        setStaticValue('');
        setTemplateValue('');
        setUploadedFile('');
        setAutoDetectedDimensions(false);
        setPosition({ x: 0, y: 0 });
        setDimensions({ width: 400, height: 400 });
        setImageMask('none');
        setTextStyle({
            fontSize: 32,
            fontFamily: 'Arial',
            fontWeight: 'normal',
            fontStyle: 'normal',
            color: '#000000',
            textAlign: 'left',
            width: 0,
            height: 0,
            autoFit: false,
            backgroundColor: '',
            padding: 0,
        });
        setTextEffects({});
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const dataUrl = event.target?.result as string;
                setUploadedFile(dataUrl);

                // Auto-detect image dimensions
                const img = new Image();
                img.onload = () => {
                    setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                    setAutoDetectedDimensions(true);
                };
                img.src = dataUrl;
            };
            reader.readAsDataURL(file);
        }
    };

    const handleAddLayer = () => {
        let source: Layer['source'];

        if (sourceType === 'csv') {
            if (!selectedColumn) {
                toast.error('Please select a column');
                return;
            }
            source = { type: 'csv', column: selectedColumn };
        } else if (sourceType === 'static') {
            if (!staticValue) {
                toast.error('Please provide a value');
                return;
            }
            source = { type: 'static', value: staticValue };
        } else if (sourceType === 'template') {
            if (!templateValue) {
                toast.error('Please provide a template');
                return;
            }
            source = { type: 'template', template: templateValue };
        } else {
            if (!uploadedFile) {
                toast.error('Please upload a file');
                return;
            }
            source = { type: 'upload', url: uploadedFile };
        }

        const baseLayer = {
            id: `layer-${Date.now()}`,
            x: position.x,
            y: position.y,
            visible: true,
            angle: 0,
        };

        if (layerType === 'image') {
            const layer: Layer = {
                ...baseLayer,
                type: 'image',
                source,
                width: dimensions.width,
                height: dimensions.height,
                mask: imageMask,
            };
            addLayer(layer);
        } else {
            const layer: Layer = {
                ...baseLayer,
                type: 'text',
                source,
                fontSize: textStyle.fontSize,
                fontFamily: textStyle.fontFamily,
                fontWeight: textStyle.fontWeight,
                fontStyle: textStyle.fontStyle,
                color: textStyle.color,
                textAlign: textStyle.textAlign,
                width: textStyle.width || undefined,
                height: textStyle.height || undefined,
                autoFit: textStyle.autoFit,
                backgroundColor: textStyle.backgroundColor || undefined,
                padding: textStyle.padding || undefined,
                // Effects
                shadow: textEffects.shadow,
                glow: textEffects.glow,
                stroke: textEffects.stroke,
                emboss: textEffects.emboss,
                gradient: textEffects.gradient,
                textTransform: textEffects.textTransform,
                orientation: textEffects.orientation,
                charSpacing: textEffects.charSpacing,
                lineHeight: textEffects.lineHeight,
            };
            addLayer(layer);
        }

        toast.success(`${layerType === 'image' ? 'Image' : 'Text'} layer added`);
        resetForm();
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => {
            onOpenChange(isOpen);
            if (isOpen) resetForm();
        }}>
            <DialogContent className="max-w-3xl max-h-[90vh] p-0 gap-0">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle>Add New Layer</DialogTitle>
                    <DialogDescription>Configure your layer properties</DialogDescription>
                </DialogHeader>

                <ScrollArea className="max-h-[calc(90vh-120px)] px-6 pb-6">
                    <div className="space-y-6 pt-4">
                        {/* Layer Type */}
                        <div className="space-y-2">
                            <Label>Layer Type</Label>
                            <Select value={layerType} onValueChange={(v) => setLayerType(v as LayerType)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="image">🖼️ Image Layer</SelectItem>
                                    <SelectItem value="text">🔤 Text Layer</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Source Type */}
                        <Tabs value={sourceType} onValueChange={(v) => setSourceType(v as any)}>
                            <TabsList className="grid w-full grid-cols-4">
                                <TabsTrigger value="csv">From CSV</TabsTrigger>
                                <TabsTrigger value="template">Template</TabsTrigger>
                                <TabsTrigger value="static">Static</TabsTrigger>
                                <TabsTrigger value="upload">Upload</TabsTrigger>
                            </TabsList>

                            <TabsContent value="csv" className="space-y-4 pt-4">
                                <div className="space-y-2">
                                    <Label>Select Column</Label>
                                    <Select value={selectedColumn} onValueChange={setSelectedColumn}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select a column" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {csvHeaders.map((header) => (
                                                <SelectItem key={header} value={header}>{header}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </TabsContent>

                            <TabsContent value="template" className="space-y-4 pt-4">
                                {layerType === 'text' ? (
                                    <div className="space-y-2">
                                        <Label>Template (click columns below to insert)</Label>
                                        <Textarea
                                            ref={templateTextareaRef}
                                            value={templateValue}
                                            onChange={(e) => setTemplateValue(e.target.value)}
                                            placeholder={"Hello {{name}}!\nWelcome to {{company}}\n\nYour personalized message here..."}
                                            rows={4}
                                            className="resize-y min-h-[100px]"
                                        />
                                        <div className="space-y-1">
                                            <p className="text-xs text-muted-foreground">Click to insert:</p>
                                            <div className="flex flex-wrap gap-1">
                                                {csvHeaders.map((header) => (
                                                    <button
                                                        key={header}
                                                        type="button"
                                                        onClick={() => insertColumnVariable(header)}
                                                        className="px-2 py-1 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded border border-primary/20 transition-colors cursor-pointer"
                                                    >
                                                        {`{{${header}}}`}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground">
                                        Template mode is only available for text layers
                                    </p>
                                )}
                            </TabsContent>

                            <TabsContent value="static" className="space-y-4 pt-4">
                                <div className="space-y-2">
                                    <Label>{layerType === 'image' ? 'Image URL' : 'Text Content'}</Label>
                                    {layerType === 'image' ? (
                                        <Input
                                            value={staticValue}
                                            onChange={(e) => setStaticValue(e.target.value)}
                                            placeholder="https://..."
                                        />
                                    ) : (
                                        <Textarea
                                            value={staticValue}
                                            onChange={(e) => setStaticValue(e.target.value)}
                                            placeholder={"Enter your text here...\n\nMultiple lines supported!"}
                                            rows={4}
                                            className="resize-y min-h-[100px]"
                                        />
                                    )}
                                </div>
                            </TabsContent>

                            <TabsContent value="upload" className="space-y-4 pt-4">
                                {layerType === 'image' && (
                                    <div className="space-y-2">
                                        <Label>Upload Image</Label>
                                        <Input type="file" accept="image/*" onChange={handleFileUpload} />
                                        {uploadedFile && (
                                            <img src={uploadedFile} alt="Preview" className="max-w-full h-32 object-contain rounded" />
                                        )}
                                    </div>
                                )}
                            </TabsContent>
                        </Tabs>

                        {/* Position */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>X Position</Label>
                                <Input
                                    type="number"
                                    value={position.x}
                                    onChange={(e) => setPosition({ ...position, x: parseInt(e.target.value) || 0 })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Y Position</Label>
                                <Input
                                    type="number"
                                    value={position.y}
                                    onChange={(e) => setPosition({ ...position, y: parseInt(e.target.value) || 0 })}
                                />
                            </div>
                        </div>

                        {/* Image-specific settings */}
                        {layerType === 'image' && (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Width {autoDetectedDimensions && sourceType === 'upload' && <span className="text-xs text-muted-foreground">(auto)</span>}</Label>
                                        <Input
                                            type="number"
                                            value={dimensions.width}
                                            onChange={(e) => { setDimensions({ ...dimensions, width: parseInt(e.target.value) || 400 }); setAutoDetectedDimensions(false); }}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Height {autoDetectedDimensions && sourceType === 'upload' && <span className="text-xs text-muted-foreground">(auto)</span>}</Label>
                                        <Input
                                            type="number"
                                            value={dimensions.height}
                                            onChange={(e) => { setDimensions({ ...dimensions, height: parseInt(e.target.value) || 400 }); setAutoDetectedDimensions(false); }}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Mask Shape</Label>
                                    <Select value={imageMask} onValueChange={(v: 'none' | 'circle') => setImageMask(v)}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">None (Rectangle)</SelectItem>
                                            <SelectItem value="circle">Circle</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        )}

                        {/* Text-specific settings with tabs for Basic and Effects */}
                        {layerType === 'text' && (
                            <Tabs defaultValue="basic" className="w-full">
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="basic" className="flex items-center gap-2">
                                        <Type className="w-4 h-4" />
                                        Basic
                                    </TabsTrigger>
                                    <TabsTrigger value="effects" className="flex items-center gap-2">
                                        <Sparkles className="w-4 h-4" />
                                        Effects
                                    </TabsTrigger>
                                </TabsList>

                                {/* Basic Text Settings */}
                                <TabsContent value="basic" className="space-y-4 pt-4">
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            checked={textStyle.autoFit}
                                            onCheckedChange={(checked) => setTextStyle({ ...textStyle, autoFit: checked })}
                                        />
                                        <Label>Auto-fit text to area</Label>
                                    </div>

                                    {textStyle.autoFit && (
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label>Max Width</Label>
                                                <Input
                                                    type="number"
                                                    value={textStyle.width}
                                                    onChange={(e) => setTextStyle({ ...textStyle, width: parseInt(e.target.value) || 0 })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Max Height</Label>
                                                <Input
                                                    type="number"
                                                    value={textStyle.height}
                                                    onChange={(e) => setTextStyle({ ...textStyle, height: parseInt(e.target.value) || 0 })}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Font Family with Upload */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label>Font Family</Label>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => fontInputRef.current?.click()}
                                                className="h-7 text-xs"
                                            >
                                                <Upload className="w-3 h-3 mr-1" />
                                                Upload Font
                                            </Button>
                                            <input
                                                ref={fontInputRef}
                                                type="file"
                                                accept=".ttf,.otf,.woff,.woff2"
                                                className="hidden"
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) {
                                                        uploadFont(file);
                                                        e.target.value = '';
                                                    }
                                                }}
                                            />
                                        </div>
                                        <Select value={textStyle.fontFamily} onValueChange={(v) => setTextStyle({ ...textStyle, fontFamily: v })}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {customFonts.length > 0 && (
                                                    <>
                                                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Custom Fonts</div>
                                                        {customFonts.map((font) => (
                                                            <div key={font} className="flex items-center justify-between pr-1">
                                                                <SelectItem value={font} style={{ fontFamily: font }} className="flex-1">
                                                                    {font}
                                                                </SelectItem>
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-6 w-6 text-destructive hover:text-destructive"
                                                                    onClick={(e) => { e.stopPropagation(); removeFont(font); }}
                                                                >
                                                                    <Trash2 className="h-3 w-3" />
                                                                </Button>
                                                            </div>
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
                                            <Label>Font Size</Label>
                                            <Input
                                                type="number"
                                                value={textStyle.fontSize}
                                                onChange={(e) => setTextStyle({ ...textStyle, fontSize: parseInt(e.target.value) || 32 })}
                                                disabled={textStyle.autoFit}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Style</Label>
                                            <div className="flex gap-2">
                                                <Button
                                                    type="button"
                                                    variant={textStyle.fontWeight === 'bold' ? 'default' : 'outline'}
                                                    size="sm"
                                                    onClick={() => setTextStyle({ ...textStyle, fontWeight: textStyle.fontWeight === 'bold' ? 'normal' : 'bold' })}
                                                    className="font-bold"
                                                >
                                                    B
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant={textStyle.fontStyle === 'italic' ? 'default' : 'outline'}
                                                    size="sm"
                                                    onClick={() => setTextStyle({ ...textStyle, fontStyle: textStyle.fontStyle === 'italic' ? 'normal' : 'italic' })}
                                                    className="italic"
                                                >
                                                    I
                                                </Button>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>Text Color</Label>
                                            <div className="flex gap-2">
                                                <Input
                                                    type="color"
                                                    value={textStyle.color}
                                                    onChange={(e) => setTextStyle({ ...textStyle, color: e.target.value })}
                                                    className="w-14 h-10 p-1 cursor-pointer"
                                                />
                                                <Input
                                                    type="text"
                                                    value={textStyle.color}
                                                    onChange={(e) => setTextStyle({ ...textStyle, color: e.target.value })}
                                                    className="flex-1 font-mono"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Alignment</Label>
                                            <Select value={textStyle.textAlign} onValueChange={(v: 'left' | 'center' | 'right') => setTextStyle({ ...textStyle, textAlign: v })}>
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

                                    {/* Text Background */}
                                    <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                                        <div className="space-y-2">
                                            <Label>Background Color</Label>
                                            <div className="flex gap-2 items-center">
                                                <Input
                                                    type="color"
                                                    value={textStyle.backgroundColor || '#ffffff'}
                                                    onChange={(e) => setTextStyle({ ...textStyle, backgroundColor: e.target.value })}
                                                    className="w-10 h-8 p-0.5 cursor-pointer"
                                                    disabled={!textStyle.backgroundColor}
                                                />
                                                <label className="flex items-center gap-1 text-sm">
                                                    <input
                                                        type="checkbox"
                                                        checked={!textStyle.backgroundColor}
                                                        onChange={(e) => setTextStyle({ ...textStyle, backgroundColor: e.target.checked ? '' : '#ffffff' })}
                                                    />
                                                    None
                                                </label>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Padding</Label>
                                            <Input
                                                type="number"
                                                min={0}
                                                max={50}
                                                value={textStyle.padding}
                                                onChange={(e) => setTextStyle({ ...textStyle, padding: parseInt(e.target.value) || 0 })}
                                                disabled={!textStyle.backgroundColor}
                                            />
                                        </div>
                                    </div>
                                </TabsContent>

                                {/* Text Effects Tab */}
                                <TabsContent value="effects" className="pt-4">
                                    <TextEffectsPanel
                                        shadow={textEffects.shadow}
                                        glow={textEffects.glow}
                                        stroke={textEffects.stroke}
                                        emboss={textEffects.emboss}
                                        gradient={textEffects.gradient}
                                        textTransform={textEffects.textTransform}
                                        orientation={textEffects.orientation}
                                        charSpacing={textEffects.charSpacing}
                                        lineHeight={textEffects.lineHeight}
                                        onUpdate={(updates) => setTextEffects({ ...textEffects, ...updates })}
                                    />
                                </TabsContent>
                            </Tabs>
                        )}

                        {/* Submit Button */}
                        <Button onClick={handleAddLayer} className="w-full" size="lg">
                            Add {layerType === 'image' ? 'Image' : 'Text'} Layer
                        </Button>
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
