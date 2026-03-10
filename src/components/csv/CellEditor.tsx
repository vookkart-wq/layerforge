import React, { useState, useRef, useEffect } from 'react';

// Dedicated Cell Editor Component to handle lifecycle properly
interface CellEditorProps {
    initialValue: string;
    onSave: (value: string) => void;
    onCancel: () => void;
}

export function CellEditor({ initialValue, onSave, onCancel }: CellEditorProps) {
    const [value, setValue] = useState(initialValue);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Focus and position cursor at end on mount
    useEffect(() => {
        if (textareaRef.current) {
            const textarea = textareaRef.current;
            // Small timeout to ensure render is complete and browser allows focus
            setTimeout(() => {
                textarea.focus();
                const len = textarea.value.length;
                textarea.setSelectionRange(len, len);
            }, 0);
        }
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
        } else if (e.key === 'Enter' && e.ctrlKey) {
            e.stopPropagation();
            onSave(value);
        }
    };

    return (
        <div
            className="absolute left-0 z-[100]"
            style={{ top: 0, minWidth: '100%' }}
        >
            <textarea
                ref={textareaRef}
                value={value}
                onChange={e => setValue(e.target.value)}
                onBlur={() => onSave(value)}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={handleKeyDown}
                className="w-full px-2 py-2 text-sm text-foreground border-2 border-primary outline-none bg-background shadow-xl rounded"
                rows={Math.max(4, Math.min(value.split('\n').length + 1, 15))}
                style={{
                    resize: 'both',
                    minWidth: 250,
                    minHeight: 100,
                    overflow: 'auto',
                }}
            />
        </div>
    );
}
