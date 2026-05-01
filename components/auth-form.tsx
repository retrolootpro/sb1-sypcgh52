'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';
import { Loader as Loader2 } from 'lucide-react';

export function AuthForm() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = isLogin
      ? await signIn(email, password)
      : await signUp(email, password);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(isLogin ? 'Welcome back!' : 'Account created successfully!');
    }

    setLoading(false);
  };

  return (
    <div className="w-full max-w-[340px]">
      <div className="mb-8">
        <div className="text-[10px] font-mono text-primary/50 tracking-widest uppercase mb-3">
          {isLogin ? '// sign_in' : '// create_account'}
        </div>
        <h2 className="heading-lg text-[22px] mb-1.5 text-white/90">
          {isLogin ? 'Welcome back' : 'Create account'}
        </h2>
        <p className="text-[14px] text-white/30">
          {isLogin ? 'Sign in to your RetroLoot Pro account' : 'Start managing your game inventory'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-[12px] text-white/35">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-11 bg-white/[0.04] border-white/[0.08] text-white/90 placeholder:text-white/20 text-[14px] focus:border-primary/40 focus:ring-0 rounded-md"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-[12px] text-white/35">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="h-11 bg-white/[0.04] border-white/[0.08] text-white/90 placeholder:text-white/20 text-[14px] focus:border-primary/40 focus:ring-0 rounded-md"
          />
        </div>

        <Button
          type="submit"
          className="w-full h-11 rounded-md text-[14px] font-semibold mt-2 bg-primary text-black hover:bg-primary/90 neon-glow-sm transition-all"
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            isLogin ? 'Sign In' : 'Create Account'
          )}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => setIsLogin(!isLogin)}
          className="text-[13px] text-white/25 hover:text-primary/80 transition-colors"
        >
          {isLogin ? 'New to RetroLoot Pro? Create account' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
