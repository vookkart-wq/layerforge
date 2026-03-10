import React, { useState, useRef, useCallback, useMemo, memo } from 'react';
import { ExternalLink, Copy, Check, Image as ImageIcon, Loader2 } from 'lucide-react';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { proxyImageUrl } from '@/lib/supabase';

// URL detection regex - matches http:// and https:// URLs for typical images
const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/gi;
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i;

interface LinkCellProps {
    value: string;
    isSelected: boolean;
}

interface UrlMatch {
    url: string;
    start: number;
    end: number;
}

// Extract all URLs from text with their positions
function extractUrls(text: string): UrlMatch[] {
    const matches: UrlMatch[] = [];
    let match;
    const regex = new RegExp(URL_REGEX.source, 'gi');
    while ((match = regex.exec(text)) !== null) {
        matches.push({
            url: match[0],
            start: match.index,
            end: match.index + match[0].length
        });
    }
    return matches;
}

// Split text into segments (text and URLs)
function splitTextWithUrls(text: string, urlMatches: UrlMatch[]): Array<{ type: 'text' | 'url'; content: string }> {
    if (urlMatches.length === 0) {
        return [{ type: 'text', content: text }];
    }

    const segments: Array<{ type: 'text' | 'url'; content: string }> = [];
    let lastEnd = 0;

    for (const match of urlMatches) {
        // Add text before this URL
        if (match.start > lastEnd) {
            segments.push({ type: 'text', content: text.slice(lastEnd, match.start) });
        }
        // Add the URL
        segments.push({ type: 'url', content: match.url });
        lastEnd = match.end;
    }

    // Add remaining text after last URL
    if (lastEnd < text.length) {
        segments.push({ type: 'text', content: text.slice(lastEnd) });
    }

    return segments;
}

// Individual URL segment with popover - memoized
const UrlSegment = memo(function UrlSegment({ url }: { url: string }) {
    const [isOpen, setIsOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copyingImage, setCopyingImage] = useState(false);
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const isImage = useMemo(() => IMAGE_EXTENSIONS.test(url), [url]);

    const handleMouseEnter = useCallback(() => {
        hoverTimeoutRef.current = setTimeout(() => {
            setIsOpen(true);
        }, 300);
    }, []);

    const handleMouseLeave = useCallback(() => {
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
        }
    }, []);

    const handleOpenLink = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        // Open link in new tab/window
        window.open(url, '_blank', 'noopener,noreferrer');
        setIsOpen(false);
    }, [url]);

    const handleCopyLink = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [url]);

    const handleCopyImage = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        if (copyingImage) return;

        setCopyingImage(true);
        try {
            // Use proxy to avoid CORS issues
            const proxiedUrl = await proxyImageUrl(url);

            // Approach: Load image into an HTMLImageElement with crossOrigin='anonymous'
            // This mirrors how the Canvas Editor works and avoids direct fetch CORS issues
            // passed through the proxy.
            const img = new Image();
            img.crossOrigin = 'anonymous'; // Critical for CORS

            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = () => reject(new Error('Failed to load image'));
                img.src = proxiedUrl;
            });

            // Draw to canvas to get a clean blob
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Failed to get canvas context');

            ctx.drawImage(img, 0, 0);

            // Convert to blob (guaranteed PNG)
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('Failed to create blob');

            // Write to clipboard
            // Clipboard API requires the blob type to match the key
            const item = new ClipboardItem({ [blob.type]: blob });
            await navigator.clipboard.write([item]);

            toast.success('Image copied to clipboard!');
            setIsOpen(false);
        } catch (error) {
            console.error('Failed to copy image:', error);
            // Fallback for CORS issues or other fetch errors
            toast.error('Failed to copy image. URL copied instead.');
            navigator.clipboard.writeText(url);
        } finally {
            setCopyingImage(false);
        }
    }, [url, copyingImage]);

    // Truncate URL for display in popover
    const truncatedUrl = url.length > 50 ? url.slice(0, 47) + '...' : url;

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <span
                    className="text-blue-500 underline cursor-pointer hover:text-blue-600"
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                    onClick={(e) => e.stopPropagation()}
                >
                    {url}
                </span>
            </PopoverTrigger>
            <PopoverContent
                className="w-auto max-w-sm p-2"
                side="top"
                align="start"
                onMouseEnter={() => setIsOpen(true)}
                onMouseLeave={() => setIsOpen(false)}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center gap-2">
                    <a
                        href={url}
                        onClick={handleOpenLink}
                        className="text-sm text-blue-500 hover:text-blue-600 hover:underline truncate flex-1 cursor-pointer"
                        title={url}
                    >
                        {truncatedUrl}
                    </a>

                    {/* Replaced Open Link button with Copy Image button for image URLs */}
                    {isImage && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={handleCopyImage}
                            disabled={copyingImage}
                            title="Copy Image to Clipboard"
                        >
                            {copyingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4 text-purple-500" />}
                        </Button>
                    )}

                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={handleCopyLink}
                        title="Copy text link"
                    >
                        {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
});

export const LinkCell = memo(function LinkCell({ value, isSelected }: LinkCellProps) {
    const urlMatches = useMemo(() => extractUrls(value), [value]);
    const segments = useMemo(() => splitTextWithUrls(value, urlMatches), [value, urlMatches]);
    const hasUrls = urlMatches.length > 0;

    // If no URLs, render simple text
    if (!hasUrls) {
        return (
            <div
                className={`px-2 py-1 text-sm cursor-cell select-text truncate ${isSelected ? 'ring-1 ring-primary ring-inset' : 'hover:bg-accent/30'}`}
                title={value}
            >
                {value || <span className="text-muted-foreground/30">-</span>}
            </div>
        );
    }

    // Render with URL highlighting
    return (
        <div
            className={`px-2 py-1 text-sm cursor-cell select-text truncate ${isSelected ? 'ring-1 ring-primary ring-inset' : 'hover:bg-accent/30'}`}
            title={value}
        >
            {segments.map((segment, idx) => (
                segment.type === 'url' ? (
                    <UrlSegment key={idx} url={segment.content} />
                ) : (
                    <span key={idx}>{segment.content}</span>
                )
            ))}
        </div>
    );
});
