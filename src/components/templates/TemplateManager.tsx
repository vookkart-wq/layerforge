import { useState, useRef } from 'react';
import { Save, Upload, FolderOpen, Trash2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { useLayerStore } from '@/stores/useLayerStore';
import { useCanvasStore } from '@/stores/useCanvasStore';
import {
    downloadTemplate,
    loadTemplateFromFile,
    getSavedTemplates,
    saveTemplateToStorage,
    loadTemplateFromStorage,
    deleteTemplateFromStorage,
    Template,
} from '@/services/templateService';
import { toast } from 'sonner';

export function TemplateManager() {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [templateName, setTemplateName] = useState('');
    const [savedTemplates, setSavedTemplates] = useState<{ name: string; savedAt: string }[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { layers, setLayers } = useLayerStore();
    const { canvasConfig, outputConfig, setCanvasConfig, setOutputConfig } = useCanvasStore();

    const refreshTemplates = () => {
        setSavedTemplates(getSavedTemplates());
    };

    const handleOpenDialog = () => {
        refreshTemplates();
        setDialogOpen(true);
    };

    const createTemplate = (): Template => ({
        name: templateName || `Template ${new Date().toLocaleDateString()}`,
        version: '1.0',
        createdAt: new Date().toISOString(),
        canvasConfig,
        outputConfig,
        layers,
    });

    const handleSaveToFile = () => {
        if (layers.length === 0) {
            toast.error('No layers to save');
            return;
        }
        const template = createTemplate();
        downloadTemplate(template);
        toast.success('Template downloaded');
    };

    const handleSaveToStorage = () => {
        if (!templateName.trim()) {
            toast.error('Please enter a template name');
            return;
        }
        if (layers.length === 0) {
            toast.error('No layers to save');
            return;
        }
        const template = createTemplate();
        saveTemplateToStorage(template);
        refreshTemplates();
        setTemplateName('');
        toast.success('Template saved');
    };

    const handleLoadFromFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const template = await loadTemplateFromFile(file);
            applyTemplate(template);
            toast.success('Template loaded');
        } catch (err) {
            toast.error('Failed to load template');
        }
        e.target.value = '';
    };

    const handleLoadFromStorage = (name: string) => {
        const template = loadTemplateFromStorage(name);
        if (template) {
            applyTemplate(template);
            setDialogOpen(false);
            toast.success('Template loaded');
        } else {
            toast.error('Template not found');
        }
    };

    const handleDeleteFromStorage = (name: string) => {
        deleteTemplateFromStorage(name);
        refreshTemplates();
        toast.success('Template deleted');
    };

    const applyTemplate = (template: Template) => {
        setCanvasConfig(template.canvasConfig);
        setOutputConfig(template.outputConfig);
        setLayers(template.layers);
    };

    return (
        <div className="flex items-center gap-1">
            {/* Quick Save to File */}
            <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleSaveToFile}
                title="Download template as file"
            >
                <Download className="w-4 h-4" />
            </Button>

            {/* Quick Load from File */}
            <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => fileInputRef.current?.click()}
                title="Load template from file"
            >
                <Upload className="w-4 h-4" />
            </Button>
            <input
                ref={fileInputRef}
                type="file"
                accept=".json,.layerforge.json"
                onChange={handleLoadFromFile}
                className="hidden"
            />

            {/* Template Manager Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={handleOpenDialog}
                        title="Manage templates"
                    >
                        <FolderOpen className="w-4 h-4" />
                    </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Template Manager</DialogTitle>
                        <DialogDescription>Save and load layer configurations</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        {/* Save New Template */}
                        <div className="space-y-2">
                            <Label>Save Current Design</Label>
                            <div className="flex gap-2">
                                <Input
                                    value={templateName}
                                    onChange={(e) => setTemplateName(e.target.value)}
                                    placeholder="Template name"
                                    className="flex-1"
                                />
                                <Button onClick={handleSaveToStorage} size="sm">
                                    <Save className="w-4 h-4 mr-1" />
                                    Save
                                </Button>
                            </div>
                        </div>

                        {/* Saved Templates List */}
                        <div className="space-y-2">
                            <Label>Saved Templates</Label>
                            {savedTemplates.length === 0 ? (
                                <p className="text-sm text-muted-foreground py-4 text-center">
                                    No saved templates yet
                                </p>
                            ) : (
                                <div className="space-y-1 max-h-[200px] overflow-auto">
                                    {savedTemplates.map((t) => (
                                        <div
                                            key={t.name}
                                            className="flex items-center justify-between p-2 hover:bg-muted rounded-lg group"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">{t.name}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {new Date(t.savedAt).toLocaleDateString()}
                                                </p>
                                            </div>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-7 w-7"
                                                    onClick={() => handleLoadFromStorage(t.name)}
                                                >
                                                    <FolderOpen className="w-3 h-3" />
                                                </Button>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-7 w-7 text-destructive"
                                                    onClick={() => handleDeleteFromStorage(t.name)}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Load from File */}
                        <div className="pt-2 border-t">
                            <Button
                                variant="outline"
                                className="w-full"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <Upload className="w-4 h-4 mr-2" />
                                Load Template from File
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
