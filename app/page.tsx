'use client';

import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AuthForm } from '@/components/auth-form';
import { ScanBarcode, TrendingUp, Zap, Package, Terminal } from 'lucide-react';

const features = [
  { icon: ScanBarcode, label: 'Barcode Scanning' },
  { icon: TrendingUp, label: 'Live Pricing' },
  { icon: Zap, label: 'Deal Scoring' },
  { icon: Package, label: 'Show Builder' },
];

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="w-8 h-8 rounded-md border border-primary/30 bg-primary/10 flex items-center justify-center animate-pulse">
          <Terminal className="w-4 h-4 text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex items-stretch overflow-hidden bg-black">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[10%] left-[5%] w-[500px] h-[500px] rounded-full bg-primary/[0.04] blur-[120px]" />
        <div className="absolute bottom-[5%] right-[10%] w-[400px] h-[400px] rounded-full bg-primary/[0.03] blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: 'linear-gradient(hsl(148 100% 50% / 0.3) 1px, transparent 1px), linear-gradient(90deg, hsl(148 100% 50% / 0.3) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      <div className="hidden lg:flex flex-col flex-1 justify-between p-16 relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md border border-primary/30 bg-primary/10 flex items-center justify-center">
            <Terminal className="w-3.5 h-3.5 text-primary" />
          </div>
          <span className="font-bold text-[15px] tracking-tight text-white/90">
            retro<span className="text-primary">loot</span>
          </span>
        </div>

        <div className="max-w-lg">
          <div className="text-[11px] font-mono text-primary/60 tracking-widest uppercase mb-4">// v2.0 pro</div>
          <h1 className="heading-display text-[52px] mb-6 leading-none text-white/90">
            The smarter way to<br />
            <span className="text-gradient-neon">resell retro games.</span>
          </h1>
          <p className="text-[16px] text-white/35 leading-relaxed mb-10">
            Scan barcodes, price in seconds, and track your entire inventory. Built for collectors and professional resellers.
          </p>
          <div className="flex flex-wrap gap-2.5">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.label} className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] text-[12px] text-white/40">
                  <Icon className="w-3.5 h-3.5 text-primary/70" />
                  {f.label}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-white/15 font-mono">
          <span className="text-primary/40">▶</span>
          retroloot pro
        </div>
      </div>

      <div className="flex flex-col items-center justify-center w-full lg:w-[420px] flex-shrink-0 lg:border-l lg:border-white/[0.06] relative z-10 p-8">
        <div className="lg:hidden flex items-center gap-2.5 mb-12">
          <div className="w-7 h-7 rounded-md border border-primary/30 bg-primary/10 flex items-center justify-center">
            <Terminal className="w-3.5 h-3.5 text-primary" />
          </div>
          <span className="font-bold text-[15px] tracking-tight text-white/90">retro<span className="text-primary">loot</span></span>
        </div>
        <AuthForm />
      </div>
    </div>
  );
}
