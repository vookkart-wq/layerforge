import { useState, useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
    const [isDark, setIsDark] = useState(() => {
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem('layerforge-theme');
            if (stored) return stored === 'dark';
            return window.matchMedia('(prefers-color-scheme: dark)').matches;
        }
        return false;
    });

    useEffect(() => {
        const root = document.documentElement;
        if (isDark) {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
        localStorage.setItem('layerforge-theme', isDark ? 'dark' : 'light');
    }, [isDark]);

    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsDark(!isDark)}
            className="w-8 h-8 p-0"
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
            {isDark ? (
                <Sun className="w-4 h-4 text-yellow-400" />
            ) : (
                <Moon className="w-4 h-4 text-slate-600" />
            )}
        </Button>
    );
}
