import { FileSpreadsheet, Trash2, Clock, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProjects, Project } from './useProjects';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

interface ProjectsDashboardProps {
    onSelectProject: (id: string) => void;
    onNewProject: () => void;
}

export function ProjectsDashboard({ onSelectProject, onNewProject }: ProjectsDashboardProps) {
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

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold">Your Workspaces</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* New Project Card */}
                <button
                    onClick={onNewProject}
                    className="group relative h-40 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-muted bg-transparent hover:bg-muted/50 hover:border-primary/50 transition-all text-muted-foreground hover:text-foreground"
                >
                    <div className="p-3 rounded-full bg-background shadow-sm group-hover:scale-110 transition-transform text-primary">
                        <Plus className="w-6 h-6" />
                    </div>
                    <span className="font-medium">New Project</span>
                </button>

                {/* Existing Projects */}
                {projects.map((project) => (
                    <div
                        key={project.id}
                        onClick={() => onSelectProject(project.id)}
                        className="group relative h-40 flex flex-col justify-between p-5 rounded-xl border bg-card hover:border-primary/50 hover:shadow-md cursor-pointer transition-all overflow-hidden"
                    >
                        {/* Background decoration */}
                        <div className="absolute -right-4 -top-4 w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors pointer-events-none" />

                        <div className="flex items-start justify-between relative z-10 gap-2">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                                    <FileSpreadsheet className="w-5 h-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h4 className="font-semibold truncate pr-2" title={project.name}>
                                        {project.name}
                                    </h4>
                                </div>
                            </div>

                            <Button
                                variant="ghost"
                                size="icon"
                                className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 -mt-1 -mr-1"
                                onClick={(e) => handleDelete(e, project)}
                                title="Delete project"
                            >
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>

                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground relative z-10">
                            <Clock className="w-3.5 h-3.5" />
                            <span>Updated {formatDistanceToNow(new Date(project.updated_at), { addSuffix: true })}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
