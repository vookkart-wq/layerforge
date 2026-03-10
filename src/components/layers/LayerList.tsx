import { Plus, Trash2, Eye, EyeOff, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLayerStore } from '@/stores/useLayerStore';
import { Layer } from '@/types';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface LayerItemProps {
    layer: Layer;
    index: number;
}

function SortableLayerItem({ layer, index }: LayerItemProps) {
    const { toggleVisibility, removeLayer, selectLayer, selectedLayerId } = useLayerStore();

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
    } = useSortable({ id: layer.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    const isSelected = selectedLayerId === layer.id;

    return (
        <div
            ref={setNodeRef}
            style={style}
            onClick={() => selectLayer(layer.id)}
            className={`flex items-center justify-between p-3 border rounded-lg transition-colors mb-2 cursor-pointer ${isSelected
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-card hover:bg-accent/50'
                }`}
        >
            <div className="flex items-center gap-2 flex-1">
                <div
                    {...attributes}
                    {...listeners}
                    className="cursor-grab text-muted-foreground hover:text-foreground"
                >
                    <GripVertical className="w-4 h-4" />
                </div>
                <div>
                    <p className="font-medium text-sm">
                        {layer.type === 'image' ? '🖼️' : '🔤'} Layer {index + 1}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {layer.source.type === 'csv'
                            ? `CSV: ${layer.source.column}`
                            : layer.source.type === 'template'
                                ? 'Template'
                                : layer.source.type === 'static'
                                    ? 'Static'
                                    : 'Uploaded'}
                    </p>
                </div>
            </div>
            <div className="flex gap-1">
                <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); toggleVisibility(layer.id); }}
                    title="Toggle visibility"
                >
                    {layer.visible ? (
                        <Eye className="w-4 h-4" />
                    ) : (
                        <EyeOff className="w-4 h-4" />
                    )}
                </Button>
                <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); }}
                    title="Delete layer"
                >
                    <Trash2 className="w-4 h-4" />
                </Button>
            </div>
        </div>
    );
}

interface LayerListProps {
    onAddLayer: () => void;
}

export function LayerList({ onAddLayer }: LayerListProps) {
    const { layers, reorderLayers } = useLayerStore();

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            const oldIndex = layers.findIndex((layer) => layer.id === active.id);
            const newIndex = layers.findIndex((layer) => layer.id === over.id);
            reorderLayers(oldIndex, newIndex);
        }
    };

    return (
        <Card className="h-fit">
            <CardHeader>
                <CardTitle>Layers</CardTitle>
                <CardDescription>Manage your design layers</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <Button onClick={onAddLayer} className="w-full">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Layer
                </Button>

                <ScrollArea className="h-[300px] pr-4">
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={layers.map((l) => l.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            <div className="space-y-2">
                                {layers.length === 0 ? (
                                    <p className="text-sm text-muted-foreground text-center py-8">
                                        No layers yet. Add your first layer to get started!
                                    </p>
                                ) : (
                                    layers.map((layer, index) => (
                                        <SortableLayerItem
                                            key={layer.id}
                                            layer={layer}
                                            index={index}
                                        />
                                    ))
                                )}
                            </div>
                        </SortableContext>
                    </DndContext>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
