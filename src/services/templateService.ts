import type { Layer, CanvasConfig, OutputConfig } from '../types';

export interface Template {
    name: string;
    version: string;
    createdAt: string;
    canvasConfig: CanvasConfig;
    outputConfig: OutputConfig;
    layers: Layer[];
}

const STORAGE_KEY = 'layerforge_autosave';
const TEMPLATES_KEY = 'layerforge_templates';

/**
 * Save template to a JSON file (download)
 */
export function downloadTemplate(template: Template): void {
    const json = JSON.stringify(template, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.download = `${template.name.replace(/[^a-z0-9]/gi, '_')}.layerforge.json`;
    link.href = url;
    link.click();

    URL.revokeObjectURL(url);
}

/**
 * Load template from a JSON file
 */
export async function loadTemplateFromFile(file: File): Promise<Template> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const json = e.target?.result as string;
                const template = JSON.parse(json) as Template;

                // Validate required fields
                if (!template.layers || !template.canvasConfig) {
                    throw new Error('Invalid template format');
                }

                resolve(template);
            } catch (err) {
                reject(new Error('Failed to parse template file'));
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}

/**
 * Auto-save current state to localStorage
 */
export function autoSave(
    layers: Layer[],
    canvasConfig: CanvasConfig,
    outputConfig: OutputConfig
): void {
    const state = {
        layers,
        canvasConfig,
        outputConfig,
        savedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/**
 * Load auto-saved state from localStorage
 */
export function loadAutoSave(): { layers: Layer[]; canvasConfig: CanvasConfig; outputConfig: OutputConfig } | null {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;

    try {
        return JSON.parse(saved);
    } catch {
        return null;
    }
}

/**
 * Clear auto-saved state
 */
export function clearAutoSave(): void {
    localStorage.removeItem(STORAGE_KEY);
}

/**
 * Get saved templates list from localStorage
 */
export function getSavedTemplates(): { name: string; savedAt: string }[] {
    const saved = localStorage.getItem(TEMPLATES_KEY);
    if (!saved) return [];

    try {
        return JSON.parse(saved);
    } catch {
        return [];
    }
}

/**
 * Save template to localStorage
 */
export function saveTemplateToStorage(template: Template): void {
    // Save the template data
    localStorage.setItem(`template_${template.name}`, JSON.stringify(template));

    // Update templates list
    const templates = getSavedTemplates();
    const existing = templates.findIndex(t => t.name === template.name);

    if (existing >= 0) {
        templates[existing].savedAt = template.createdAt;
    } else {
        templates.push({ name: template.name, savedAt: template.createdAt });
    }

    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
}

/**
 * Load template from localStorage
 */
export function loadTemplateFromStorage(name: string): Template | null {
    const saved = localStorage.getItem(`template_${name}`);
    if (!saved) return null;

    try {
        return JSON.parse(saved) as Template;
    } catch {
        return null;
    }
}

/**
 * Delete template from localStorage
 */
export function deleteTemplateFromStorage(name: string): void {
    localStorage.removeItem(`template_${name}`);

    const templates = getSavedTemplates().filter(t => t.name !== name);
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
}
