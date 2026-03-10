import { FileSpreadsheet, Trash2, Clock, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProjects, Project } from './useProjects';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

interface ProjectsDashboardProps {
    onSelectProject: (id: string) => void;
}

export function ProjectsDashboard({ onSelectProject }: ProjectsDashboardProps) {
    const { projects, isLoading, deleteProject } = useProjects();

    const handleDelete = async (e: React.MouseEvent, project: Project) => {
        e.stopPropagation(); // Don't trigger the card click

        if (window.confirm(`Are you sure you want to delete "${project.name}"? This cannot be undone.`)) {
            const success = await deleteProject(project.id);
            if (success) {
                toast.success(`Deleted project: ${project.name}`);
            }
        }
    };

    if (isLoading) {
        return (
            <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (!projects || projects.length === 0) {
        return null;
    }

    return (
        <div className="space-y-4">
            <h3 className="text-xl font-semibold px-1">Recent Workspaces</h3>

            <div className="flex flex-col gap-2">
                {projects.map((project) => (
                    <div
                        key={project.id}
                        onClick={() => onSelectProject(project.id)}
                        className="group flex items-center justify-between p-4 rounded-xl border bg-card hover:border-primary/50 hover:bg-accent/30 cursor-pointer transition-all"
                    >
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                            <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                                <FileSpreadsheet className="w-5 h-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h4 className="font-semibold text-base truncate pr-4" title={project.name}>
                                    {project.name}
                                </h4>
                            </div>
                        </div>

                        <div className="flex items-center gap-6 shrink-0">
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <Clock className="w-4 h-4" />
                                <span>{formatDistanceToNow(new Date(project.updated_at), { addSuffix: true })}</span>
                            </div>

                            <Button
                                variant="ghost"
                                size="icon"
                                className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive hover:bg-destructive/10 -my-2 -mr-2"
                                onClick={(e) => handleDelete(e, project)}
                                title="Delete project"
                            >
                                <Trash2 className="w-5 h-5" />
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
