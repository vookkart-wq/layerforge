import { Grid3X3, Magnet } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useCanvasStore } from '@/stores/useCanvasStore';

export function GridSettings() {
    const { gridSettings, setGridSettings } = useCanvasStore();

    return (
        <div className="space-y-3">
            {/* Show Grid Toggle */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Grid3X3 className="w-4 h-4 text-muted-foreground" />
                    <Label className="text-sm">Show Grid</Label>
                </div>
                <Switch
                    checked={gridSettings.showGrid}
                    onCheckedChange={(checked) => setGridSettings({ showGrid: checked })}
                />
            </div>

            {/* Show Center Guides */}
            <div className="flex items-center justify-between">
                <Label className="text-sm">Center Guides</Label>
                <Switch
                    checked={gridSettings.showGuides}
                    onCheckedChange={(checked) => setGridSettings({ showGuides: checked })}
                />
            </div>

            {/* Snap to Grid */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Magnet className="w-4 h-4 text-muted-foreground" />
                    <Label className="text-sm">Snap to Grid</Label>
                </div>
                <Switch
                    checked={gridSettings.snapToGrid}
                    onCheckedChange={(checked) => setGridSettings({ snapToGrid: checked })}
                />
            </div>

            {/* Grid Size */}
            <div className="flex items-center justify-between">
                <Label className="text-sm">Grid Size (px)</Label>
                <Input
                    type="number"
                    min={5}
                    max={100}
                    value={gridSettings.gridSize}
                    onChange={(e) => setGridSettings({ gridSize: parseInt(e.target.value) || 20 })}
                    className="w-20 h-8 text-sm"
                />
            </div>
        </div>
    );
}
