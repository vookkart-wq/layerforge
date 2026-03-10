import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Layers } from 'lucide-react';
import { toast } from 'sonner';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export function LoginScreen() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSignUp, setIsSignUp] = useState(false);

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            if (isSignUp) {
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                });
                if (error) throw error;
                toast.success('Registration successful! You can now log in.');
                setIsSignUp(false); // Switch back to login
            } else {
                const { error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });
                if (error) throw error;
                toast.success('Logged in successfully');
            }
        } catch (error: any) {
            toast.error(error.message || 'Authentication failed');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex flex-col bg-gradient-to-br from-background via-background to-accent/10">
            <div className="absolute top-4 right-4">
                <ThemeToggle />
            </div>

            <div className="flex-1 flex items-center justify-center p-4">
                <div className="w-full max-w-md space-y-8 bg-card p-8 rounded-xl border shadow-lg relative overflow-hidden">
                    {/* Decorative background blur */}
                    <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />

                    <div className="text-center relative z-10">
                        <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6 ring-1 ring-primary/20">
                            <Layers className="w-8 h-8 text-primary" />
                        </div>
                        <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent mb-2">
                            LayerForge
                        </h2>
                        <p className="text-muted-foreground">
                            {isSignUp ? 'Create a workspace account' : 'Sign in to your workspace'}
                        </p>
                    </div>

                    <form onSubmit={handleAuth} className="space-y-4 relative z-10">
                        <div className="space-y-4">
                            <div>
                                <Input
                                    type="email"
                                    placeholder="name@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="bg-background/50 h-11"
                                />
                            </div>
                            <div>
                                <Input
                                    type="password"
                                    placeholder="Password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className="bg-background/50 h-11"
                                />
                            </div>
                        </div>

                        <Button type="submit" className="w-full h-11" disabled={isLoading}>
                            {isLoading ? 'Please wait...' : (isSignUp ? 'Create Account' : 'Sign In')}
                        </Button>
                    </form>

                    <div className="text-center relative z-10 pt-4 border-t mt-6">
                        <button
                            onClick={() => setIsSignUp(!isSignUp)}
                            className="text-sm text-muted-foreground hover:text-primary transition-colors"
                        >
                            {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
