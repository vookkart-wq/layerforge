import { useState, useEffect, useRef } from 'react';
import { Layers, Cloud, Table, LogOut, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toaster } from '@/components/ui/toaster';
import { CSVUploader } from '@/components/csv/CSVUploader';
import { CSVEditorPage } from '@/components/csv/CSVEditorPage';
import { CanvasPreview } from '@/components/canvas/CanvasPreview';
import { CanvasSettings, OutputSettings } from '@/components/settings/CanvasSettings';
import { GridSettings } from '@/components/settings/GridSettings';
import { LayerList } from '@/components/layers/LayerList';
import { LayerProperties } from '@/components/layers/LayerProperties';
import { AddLayerDialog } from '@/components/layers/AddLayerDialog';
import { CloudinaryPanel } from '@/components/export/CloudinaryPanel';
import { TemplateManager } from '@/components/templates/TemplateManager';
import { useCSVStore } from '@/stores/useCSVStore';
import { useFontStore } from '@/stores/useFontStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth/AuthProvider';
import { LoginScreen } from '@/components/auth/LoginScreen';
import { ProjectsDashboard } from '@/components/auth/ProjectsDashboard';
import { useWorkspaceSync } from '@/components/auth/useWorkspaceSync';
import { useGlobalSettingsSync } from '@/components/auth/useGlobalSettingsSync';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { supabase } from '@/lib/supabase';

function App() {
  const { user, isLoading, signOut } = useAuth();
  const [showAddLayerDialog, setShowAddLayerDialog] = useState(false);

  // Dashboard & Workspace states
  const [showDashboard, setShowDashboard] = useState(true);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);

  // Initialize background sync to Supabase
  useWorkspaceSync(currentProjectId);
  useGlobalSettingsSync();

  const readyForEditor = useCSVStore((s) => s.readyForEditor);
  const setCSVData = useCSVStore((s) => s.setCSVData);
  const loadStoredFonts = useFontStore((s) => s.loadStoredFonts);

  // Clear stale CSV state from localStorage when on the dashboard
  // This prevents ghost state from lingering across page refreshes
  useEffect(() => {
    if (showDashboard && !currentProjectId) {
      const stored = localStorage.getItem('csv-editor-storage');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed?.state?.isLoaded) {
            // Stale state detected — clear it
            useCSVStore.getState().clearCSVData();
          }
        } catch { /* ignore parse errors */ }
      }
    }
  }, [showDashboard, currentProjectId]);

  // Layer store for undo
  const { selectedLayerId, undo, redo, canUndo, canRedo } = useLayerStore();

  // Refs for collapsible panels
  const propertiesRef = useRef<HTMLDetailsElement>(null);

  // Load stored custom fonts on app startup
  useEffect(() => {
    loadStoredFonts();
  }, [loadStoredFonts]);

  // Remove the dangerous auto-creation useEffect
  // Project creation is now handled explicitly by the handleCSVUpload callback

  const handleCSVUpload = async (uploadData: any[], uploadHeaders: string[], uploadFileName: string) => {
    if (!user) return;
    try {
      // 1. Save directly to Supabase to create the workspace
      const { data: newProject, error } = await supabase
        .from('projects')
        .insert({
          user_id: user.id,
          name: uploadFileName,
          state: {
            csv: { data: uploadData, headers: uploadHeaders, fileName: uploadFileName }
          }
        })
        .select('id')
        .single();

      if (error) throw error;

      if (newProject) {
        // 2. Load into global state ONLY after successful cloud creation
        setCSVData(uploadData, uploadHeaders, uploadFileName);
        setCurrentProjectId(newProject.id);
        setShowDashboard(false);
      }
    } catch (e: any) {
      console.error('Failed to create project:', e);
      if (e.message?.includes('payload') || e.code === '413') {
        toast.error('File too large to save to cloud. Maximum size is ~5MB.');
      } else {
        toast.error('Failed to save new project to cloud.');
      }
    }
  };

  // Auto-open Properties panel when a layer is selected
  useEffect(() => {
    if (selectedLayerId && propertiesRef.current) {
      propertiesRef.current.open = true;
    }
  }, [selectedLayerId]);

  // Keyboard shortcuts (only for canvas editor)
  useEffect(() => {
    if (!readyForEditor) return; // Skip shortcuts when in CSV editor

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Z = Undo
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo()) {
          undo();
          toast.info('Undo');
        }
      }
      // Ctrl+Shift+Z or Ctrl+Y = Redo
      if ((e.ctrlKey && e.shiftKey && e.key === 'z') || (e.ctrlKey && e.key === 'y')) {
        e.preventDefault();
        if (canRedo()) {
          redo();
          toast.info('Redo');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, canUndo, canRedo, readyForEditor]);

  const handleStartEmpty = async () => {
    if (!user) return;

    // 1. Setup default state
    const headers = ['Column 1', 'Column 2', 'Column 3'];
    const data = Array(10).fill(null).map((_, i) => ({
      __idx: String(i),
      'Column 1': '',
      'Column 2': '',
      'Column 3': ''
    }));

    // 2. Create the project in Supabase immediately
    try {
      const { data: projectData, error } = await supabase
        .from('projects')
        .insert({
          user_id: user.id,
          name: `Blank Project - ${new Date().toLocaleDateString()}`,
          state: {
            csv: { data, headers, fileName: 'Blank Project' }
          }
        })
        .select('id')
        .single();

      if (error) throw error;

      // 3. Update local state and set active project
      setCSVData(data, headers);
      setCurrentProjectId(projectData.id);
      setShowDashboard(false);

      toast.success('Created new blank workspace');
    } catch (e) {
      console.error(e);
      toast.error('Could not create project');
    }
  };

  const handleSelectProject = (projectId: string) => {
    // Setting this ID triggers the useWorkspaceSync hook to download the state
    setCurrentProjectId(projectId);
    setShowDashboard(false);
  };

  const handleReturnToDashboard = () => {
    setShowDashboard(true);
    setCurrentProjectId(null);
    useCSVStore.getState().clearCSVData();
  }

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Toaster />
        <LoginScreen />
      </>
    );
  }

  // State 1: Dashboard or Uploader
  // Always show Dashboard if showDashboard is explicitly true, OR if there's no project selected yet.
  if (showDashboard || !currentProjectId) {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-gradient-to-br from-background via-background to-accent/10">
        <Toaster />
        <header className="flex-shrink-0 border-b bg-background/95 backdrop-blur z-50">
          <div className="px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-6 h-6 text-primary" />
              <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">
                LayerForge
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <ThemeToggle />
              <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground hover:text-destructive">
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto">
          <div className="container mx-auto px-4 py-12 max-w-4xl space-y-12">

            {/* Top Section: Quick Start (Uploader & Scratch Button) */}
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold">Start New Workspace</h2>
                <Button variant="outline" className="gap-2" onClick={handleStartEmpty}>
                  <Table className="w-4 h-4" />
                  Empty Canvas
                </Button>
              </div>

              <CSVUploader onUploadSuccess={handleCSVUpload} />
            </div>

            {/* Bottom Section: Recent Projects List */}
            <div className="animate-in fade-in slide-in-from-bottom-8">
              <ProjectsDashboard onSelectProject={handleSelectProject} />
            </div>

          </div>
        </div>
      </div>
    );
  }

  // State 2: CSV loaded but not ready for editor - Show full-page spreadsheet editor
  if (!readyForEditor) {
    return (
      <div className="h-screen flex flex-col">
        <div className="flex-1 overflow-hidden relative">
          <Toaster />
          <CSVEditorPage onReturnToDashboard={handleReturnToDashboard} />
        </div>
      </div>
    );
  }

  // State 3: Ready for canvas editor
  return (
    <ErrorBoundary onReset={handleReturnToDashboard}>
      <div className="h-screen flex flex-col overflow-hidden bg-gradient-to-br from-background via-background to-accent/10">
        <Toaster />

        <Tabs defaultValue="editor" className="flex-1 flex flex-col min-h-0">
          {/* Header with Tabs */}
          <header className="flex-shrink-0 border-b bg-background/95 backdrop-blur z-50">
            <div className="px-4 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleReturnToDashboard} className="mr-2 h-8 px-2">
                  ← Home
                </Button>
                <Layers className="w-6 h-6 text-primary" />
                <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent hidden sm:block">
                  LayerForge
                </h1>
              </div>
              <div className="flex items-center gap-3">
                {/* Editor/Cloudinary Tabs */}
                <TabsList className="h-8 bg-muted/50">
                  <TabsTrigger value="editor" className="text-xs data-[state=active]:bg-background px-3">
                    <Layers className="w-3 h-3 mr-1" />
                    Editor
                  </TabsTrigger>
                  <TabsTrigger value="cloudinary" className="text-xs data-[state=active]:bg-background px-3">
                    <Cloud className="w-3 h-3 mr-1" />
                    Cloudinary
                  </TabsTrigger>
                </TabsList>

                <div className="w-px h-6 bg-border" />

                <TemplateManager />
                <Button variant="outline" size="sm" onClick={() => useCSVStore.getState().goBackToCSVEditor()}>
                  ← CSV
                </Button>
              </div>
            </div>
          </header>

          {/* Editor Tab */}
          <TabsContent value="editor" className="flex-1 m-0 min-h-0">
            <div className="h-full flex">
              {/* Left: Canvas Preview */}
              <div className="flex-1 min-w-0">
                <CanvasPreview />
              </div>

              {/* Right: Scrollable Panels */}
              <div className="w-[380px] flex-shrink-0 border-l bg-background flex flex-col min-h-0">
                <ScrollArea className="flex-1">
                  <div className="p-3 space-y-2">
                    {/* Canvas & Grid Settings */}
                    <details className="group" open>
                      <summary className="flex items-center justify-between cursor-pointer p-2 bg-muted/50 rounded hover:bg-muted transition-colors text-sm">
                        <span className="font-medium">🎨 Canvas & Grid</span>
                        <span className="text-xs group-open:rotate-90 transition-transform">▶</span>
                      </summary>
                      <div className="pt-2 space-y-4">
                        <CanvasSettings />
                        <div className="border-t pt-3">
                          <p className="text-xs font-medium text-muted-foreground mb-2">Grid & Snap</p>
                          <GridSettings />
                        </div>
                      </div>
                    </details>

                    {/* Layers */}
                    <details className="group">
                      <summary className="flex items-center justify-between cursor-pointer p-2 bg-muted/50 rounded hover:bg-muted transition-colors text-sm">
                        <span className="font-medium">📚 Layers</span>
                        <span className="text-xs group-open:rotate-90 transition-transform">▶</span>
                      </summary>
                      <div className="pt-2">
                        <LayerList onAddLayer={() => setShowAddLayerDialog(true)} />
                      </div>
                    </details>

                    {/* Properties */}
                    <details className="group" ref={propertiesRef}>
                      <summary className="flex items-center justify-between cursor-pointer p-2 bg-muted/50 rounded hover:bg-muted transition-colors text-sm">
                        <span className="font-medium">⚙️ Properties</span>
                        <span className="text-xs group-open:rotate-90 transition-transform">▶</span>
                      </summary>
                      <div className="pt-2">
                        <LayerProperties />
                      </div>
                    </details>

                    {/* Output Settings */}
                    <details className="group">
                      <summary className="flex items-center justify-between cursor-pointer p-2 bg-muted/50 rounded hover:bg-muted transition-colors text-sm">
                        <span className="font-medium">📤 Output</span>
                        <span className="text-xs group-open:rotate-90 transition-transform">▶</span>
                      </summary>
                      <div className="pt-2">
                        <OutputSettings />
                      </div>
                    </details>
                  </div>
                </ScrollArea>
              </div>
            </div>
          </TabsContent>

          {/* Cloudinary Tab */}
          <TabsContent value="cloudinary" className="flex-1 m-0 overflow-auto p-4">
            <CloudinaryPanel />
          </TabsContent>
        </Tabs>

        {/* Add Layer Dialog */}
        <AddLayerDialog open={showAddLayerDialog} onOpenChange={setShowAddLayerDialog} />
      </div>
    </ErrorBoundary>
  );
}

export default App;
