import { useCallback, useState } from 'react';
import Papa from 'papaparse';
import { Upload, Link, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCSVStore } from '@/stores/useCSVStore';
import { toast } from 'sonner';

export function CSVUploader() {
    const [isDragging, setIsDragging] = useState(false);
    const [sheetUrl, setSheetUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const { data, setCSVData } = useCSVStore();

    // Parse CSV text and load into store
    const parseCSVText = useCallback((csvText: string, source: string) => {
        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                if (results.data.length === 0) {
                    toast.error('No data found');
                    return;
                }

                const csvHeaders = Object.keys(results.data[0] as object);
                setCSVData(results.data as Record<string, string>[], csvHeaders);
                toast.success(`Loaded ${results.data.length} rows from ${source}`);
            },
            error: (error: Error) => {
                toast.error(`Error parsing CSV: ${error.message}`);
            },
        });
    }, [setCSVData]);

    const handleFile = useCallback((file: File) => {
        if (!file.name.endsWith('.csv')) {
            toast.error('Please upload a CSV file');
            return;
        }

        Papa.parse(file, {
            header: true,
            complete: (results) => {
                if (results.data.length === 0) {
                    toast.error('CSV file is empty');
                    return;
                }

                const csvHeaders = Object.keys(results.data[0] as object);
                setCSVData(results.data as Record<string, string>[], csvHeaders);
                toast.success(`Loaded ${results.data.length} rows with ${csvHeaders.length} columns`);
            },
            error: (error) => {
                toast.error(`Error parsing CSV: ${error.message}`);
            },
        });
    }, [setCSVData]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    }, [handleFile]);

    const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
    }, [handleFile]);

    // Extract sheet ID from various Google Sheets URL formats
    const extractSheetId = (url: string): string | null => {
        // Handle both /edit and /pub links
        const patterns = [
            /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,  // Standard format
            /\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/,  // Published format
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    };

    // Extract gid (sheet tab) from URL
    const extractGid = (url: string): string => {
        const match = url.match(/gid=(\d+)/);
        return match ? match[1] : '0';
    };

    const handleGoogleSheetImport = async () => {
        if (!sheetUrl.trim()) {
            toast.error('Please enter a Google Sheets URL');
            return;
        }

        const sheetId = extractSheetId(sheetUrl);
        if (!sheetId) {
            toast.error('Invalid Google Sheets URL. Please use a sharing link.');
            return;
        }

        setLoading(true);
        const gid = extractGid(sheetUrl);

        // Build CSV export URL
        const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

        try {
            const response = await fetch(csvUrl);

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    throw new Error('Sheet is not public. Please set sharing to "Anyone with the link"');
                }
                throw new Error(`Failed to fetch: ${response.statusText}`);
            }

            const csvText = await response.text();

            if (csvText.includes('<!DOCTYPE html>') || csvText.includes('<html')) {
                throw new Error('Sheet is not public. Please set sharing to "Anyone with the link"');
            }

            parseCSVText(csvText, 'Google Sheets');
        } catch (error) {
            console.error('Error fetching Google Sheet:', error);
            toast.error(error instanceof Error ? error.message : 'Failed to fetch Google Sheet');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Import CSV Data</CardTitle>
                    <CardDescription>
                        Upload a CSV file or import directly from Google Sheets
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs defaultValue="file" className="w-full">
                        <TabsList className="grid w-full grid-cols-2 mb-4">
                            <TabsTrigger value="file">
                                <Upload className="w-4 h-4 mr-2" />
                                File Upload
                            </TabsTrigger>
                            <TabsTrigger value="gsheet">
                                <Link className="w-4 h-4 mr-2" />
                                Google Sheets
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="file">
                            <div
                                onDrop={handleDrop}
                                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={() => setIsDragging(false)}
                                className={`border-2 border-dashed rounded-lg p-12 text-center transition-all ${isDragging
                                    ? 'border-primary bg-accent/50'
                                    : 'border-border hover:border-primary/50 hover:bg-accent/20'
                                    }`}
                            >
                                <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                                <p className="text-lg font-medium mb-2">Drop your CSV file here</p>
                                <p className="text-sm text-muted-foreground mb-4">or</p>
                                <label htmlFor="csv-upload">
                                    <Button asChild>
                                        <span>Browse Files</span>
                                    </Button>
                                    <input
                                        id="csv-upload"
                                        type="file"
                                        accept=".csv"
                                        onChange={handleFileInput}
                                        className="hidden"
                                    />
                                </label>
                            </div>
                        </TabsContent>

                        <TabsContent value="gsheet">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="sheet-url">Google Sheets URL</Label>
                                    <Input
                                        id="sheet-url"
                                        type="url"
                                        placeholder="https://docs.google.com/spreadsheets/d/..."
                                        value={sheetUrl}
                                        onChange={(e) => setSheetUrl(e.target.value)}
                                        disabled={loading}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        ⚠️ The sheet must be set to "Anyone with the link can view"
                                    </p>
                                </div>
                                <Button
                                    onClick={handleGoogleSheetImport}
                                    disabled={loading || !sheetUrl.trim()}
                                    className="w-full"
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Importing...
                                        </>
                                    ) : (
                                        <>
                                            <Link className="w-4 h-4 mr-2" />
                                            Import from Google Sheets
                                        </>
                                    )}
                                </Button>

                                <div className="p-3 bg-muted/50 rounded-lg text-sm">
                                    <p className="font-medium mb-1">How to share your Google Sheet:</p>
                                    <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
                                        <li>Open your Google Sheet</li>
                                        <li>Click <strong>Share</strong> (top right)</li>
                                        <li>Change to <strong>"Anyone with the link"</strong></li>
                                        <li>Copy the URL and paste it above</li>
                                    </ol>
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>
        </div>
    );
}
