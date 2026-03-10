import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthProvider';

export interface Project {
    id: string;
    user_id: string;
    name: string;
    created_at: string;
    updated_at: string;
}

export function useProjects() {
    const { user } = useAuth();
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const loadProjects = async () => {
        if (!user) return;
        setIsLoading(true);
        try {
            // Just fetch the metadata (id, name, dates), not the heavy JSON state
            const { data, error } = await supabase
                .from('projects')
                .select('id, user_id, name, created_at, updated_at')
                .order('updated_at', { ascending: false });

            if (error) throw error;
            setProjects(data || []);
        } catch (e) {
            console.error('Failed to load projects', e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadProjects();
    }, [user]);

    const deleteProject = async (id: string) => {
        if (!user) return;
        try {
            const { error } = await supabase.from('projects').delete().eq('id', id);
            if (error) throw error;
            setProjects(projects.filter(p => p.id !== id));
            return true;
        } catch (e) {
            console.error('Failed to delete project', e);
            return false;
        }
    };

    return {
        projects,
        isLoading,
        refreshProjects: loadProjects,
        deleteProject
    };
}
