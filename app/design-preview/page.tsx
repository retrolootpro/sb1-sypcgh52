'use client';

import { Package, TrendingUp, ScanBarcode, Zap, ArrowUpRight, ArrowDownRight, ChartBar as BarChart2, Box, DollarSign, ShoppingCart } from 'lucide-react';

const stats = [
  { label: 'Total Items', value: '1,284', change: '+12%', up: true },
  { label: 'Revenue', value: '$8,340', change: '+8.2%', up: true },
  { label: 'Cost Basis', value: '$4,120', change: '-3.1%', up: false },
  { label: 'Margin', value: '50.6%', change: '+2.4%', up: true },
];

const items = [
  { name: 'Super Mario Bros 3', platform: 'NES', buy: '$18', sell: '$54', score: 92 },
  { name: 'Chrono Trigger', platform: 'SNES', buy: '$42', sell: '$110', score: 88 },
  { name: 'Metal Gear Solid', platform: 'PS1', buy: '$12', sell: '$38', score: 76 },
];

export default function DesignPreview() {
  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-800 mb-2 text-center">Stockr — Design Direction Previews</h1>
        <p className="text-gray-500 text-center mb-10 text-sm">Click the style you prefer and let me know!</p>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">

          {/* 1. MINIMAL/SHARP */}
          <div className="rounded-2xl overflow-hidden shadow-xl border border-gray-200">
            <div className="px-5 py-3 bg-white border-b border-gray-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Option 1 — Minimal / Sharp</span>
              <span className="text-xs text-gray-300">Clean SaaS</span>
            </div>
            <div className="bg-white p-6" style={{ fontFamily: 'Inter, sans-serif' }}>
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center">
                    <Box className="w-4 h-4 text-white" />
                  </div>
                  <span className="font-bold text-[15px] tracking-tight text-gray-900">stockr</span>
                </div>
                <button className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-md font-medium">+ Add Item</button>
              </div>
              {/* Stats */}
              <div className="grid grid-cols-4 gap-3 mb-5">
                {stats.map((s) => (
                  <div key={s.label} className="border border-gray-100 rounded-lg p-3">
                    <div className="text-[11px] text-gray-400 mb-1">{s.label}</div>
                    <div className="text-[18px] font-bold text-gray-900 leading-none mb-1">{s.value}</div>
                    <div className={`text-[11px] font-medium flex items-center gap-0.5 ${s.up ? 'text-blue-600' : 'text-red-500'}`}>
                      {s.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {s.change}
                    </div>
                  </div>
                ))}
              </div>
              {/* Table */}
              <div className="border border-gray-100 rounded-lg overflow-hidden">
                <div className="grid grid-cols-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <span className="col-span-2">Item</span>
                  <span className="text-right">Buy / Sell</span>
                  <span className="text-right">Score</span>
                </div>
                {items.map((item) => (
                  <div key={item.name} className="grid grid-cols-4 px-4 py-3 border-b border-gray-50 last:border-0 items-center hover:bg-gray-50 transition-colors">
                    <div className="col-span-2">
                      <div className="text-[13px] font-semibold text-gray-900">{item.name}</div>
                      <div className="text-[11px] text-gray-400">{item.platform}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-[12px] text-gray-500">{item.buy}</span>
                      <span className="text-gray-300 mx-1">→</span>
                      <span className="text-[12px] font-semibold text-gray-900">{item.sell}</span>
                    </div>
                    <div className="text-right">
                      <span className={`text-[12px] font-bold px-2 py-0.5 rounded-md ${item.score >= 85 ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-600'}`}>
                        {item.score}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 2. DARK INDUSTRIAL */}
          <div className="rounded-2xl overflow-hidden shadow-xl">
            <div className="px-5 py-3 bg-[#111] border-b border-white/5 flex items-center justify-between">
              <span className="text-xs font-semibold text-white/30 uppercase tracking-widest">Option 2 — Dark Industrial</span>
              <span className="text-xs text-white/15">Serious Ops</span>
            </div>
            <div className="bg-[#0d0d0d] p-6" style={{ fontFamily: "'DM Mono', monospace, sans-serif" }}>
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-sm bg-orange-500 flex items-center justify-center">
                    <Box className="w-4 h-4 text-black" />
                  </div>
                  <span className="font-bold text-[15px] tracking-widest text-white uppercase">STOCKR</span>
                </div>
                <button className="text-xs bg-orange-500 text-black px-3 py-1.5 rounded-sm font-bold uppercase tracking-wider">+ Add</button>
              </div>
              {/* Stats */}
              <div className="grid grid-cols-4 gap-3 mb-5">
                {stats.map((s) => (
                  <div key={s.label} className="border border-white/5 rounded-sm p-3 bg-white/[0.02]">
                    <div className="text-[10px] text-white/30 mb-1 uppercase tracking-wider">{s.label}</div>
                    <div className="text-[18px] font-bold text-white leading-none mb-1">{s.value}</div>
                    <div className={`text-[11px] font-bold flex items-center gap-0.5 ${s.up ? 'text-orange-400' : 'text-red-400'}`}>
                      {s.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {s.change}
                    </div>
                  </div>
                ))}
              </div>
              {/* Table */}
              <div className="border border-white/5 rounded-sm overflow-hidden">
                <div className="grid grid-cols-4 text-[10px] font-bold text-white/25 uppercase tracking-widest px-4 py-2.5 bg-white/[0.02] border-b border-white/5">
                  <span className="col-span-2">Item</span>
                  <span className="text-right">Buy / Sell</span>
                  <span className="text-right">Score</span>
                </div>
                {items.map((item) => (
                  <div key={item.name} className="grid grid-cols-4 px-4 py-3 border-b border-white/[0.03] last:border-0 items-center hover:bg-white/[0.02] transition-colors">
                    <div className="col-span-2">
                      <div className="text-[13px] font-semibold text-white/90">{item.name}</div>
                      <div className="text-[11px] text-white/25 uppercase tracking-wider">{item.platform}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-[12px] text-white/40">{item.buy}</span>
                      <span className="text-white/15 mx-1">→</span>
                      <span className="text-[12px] font-bold text-orange-400">{item.sell}</span>
                    </div>
                    <div className="text-right">
                      <span className={`text-[12px] font-bold px-2 py-0.5 rounded-sm ${item.score >= 85 ? 'bg-orange-500/20 text-orange-400' : 'bg-white/5 text-white/40'}`}>
                        {item.score}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 3. NEON UTILITY */}
          <div className="rounded-2xl overflow-hidden shadow-xl">
            <div className="px-5 py-3 bg-black border-b border-white/5 flex items-center justify-between">
              <span className="text-xs font-semibold text-white/30 uppercase tracking-widest">Option 3 — Neon Utility</span>
              <span className="text-xs text-white/15">Data-Forward</span>
            </div>
            <div className="bg-black p-6" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-md border border-[#00ff88]/30 bg-[#00ff88]/10 flex items-center justify-center">
                    <Box className="w-4 h-4 text-[#00ff88]" />
                  </div>
                  <span className="font-bold text-[15px] tracking-tight text-white">stock<span className="text-[#00ff88]">r</span></span>
                </div>
                <button className="text-xs border border-[#00ff88]/40 text-[#00ff88] px-3 py-1.5 rounded-md font-semibold hover:bg-[#00ff88]/10 transition-colors">+ Add Item</button>
              </div>
              {/* Stats */}
              <div className="grid grid-cols-4 gap-3 mb-5">
                {stats.map((s) => (
                  <div key={s.label} className="border border-white/5 rounded-lg p-3 bg-white/[0.02]">
                    <div className="text-[10px] text-white/30 mb-1 uppercase tracking-wider">{s.label}</div>
                    <div className="text-[18px] font-bold text-white leading-none mb-1">{s.value}</div>
                    <div className={`text-[11px] font-semibold flex items-center gap-0.5 ${s.up ? 'text-[#00ff88]' : 'text-red-400'}`}>
                      {s.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {s.change}
                    </div>
                  </div>
                ))}
              </div>
              {/* Table */}
              <div className="border border-white/5 rounded-lg overflow-hidden">
                <div className="grid grid-cols-4 text-[10px] font-semibold text-white/25 uppercase tracking-widest px-4 py-2.5 bg-white/[0.02] border-b border-white/5">
                  <span className="col-span-2">Item</span>
                  <span className="text-right">Buy / Sell</span>
                  <span className="text-right">Score</span>
                </div>
                {items.map((item) => (
                  <div key={item.name} className="grid grid-cols-4 px-4 py-3 border-b border-white/[0.04] last:border-0 items-center hover:bg-white/[0.02] transition-colors">
                    <div className="col-span-2">
                      <div className="text-[13px] font-semibold text-white/90">{item.name}</div>
                      <div className="text-[11px] text-white/25 uppercase tracking-wider">{item.platform}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-[12px] text-white/35">{item.buy}</span>
                      <span className="text-white/15 mx-1">→</span>
                      <span className="text-[12px] font-semibold text-[#00ff88]">{item.sell}</span>
                    </div>
                    <div className="text-right">
                      <span className={`text-[12px] font-bold px-2 py-0.5 rounded-md ${item.score >= 85 ? 'bg-[#00ff88]/15 text-[#00ff88]' : 'bg-white/5 text-white/40'}`}>
                        {item.score}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 4. WARM EDITORIAL */}
          <div className="rounded-2xl overflow-hidden shadow-xl border border-amber-100">
            <div className="px-5 py-3 bg-[#faf8f4] border-b border-amber-100/80 flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-900/30 uppercase tracking-widest">Option 4 — Warm Editorial</span>
              <span className="text-xs text-amber-900/20">Refined & Distinct</span>
            </div>
            <div className="bg-[#faf8f4] p-6" style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}>
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-[#2d5a27] flex items-center justify-center">
                    <Box className="w-4 h-4 text-[#faf8f4]" />
                  </div>
                  <span className="font-bold text-[16px] tracking-tight text-[#1a1a1a]" style={{ fontFamily: 'Georgia, serif' }}>Stockr</span>
                </div>
                <button className="text-xs bg-[#2d5a27] text-[#faf8f4] px-3 py-1.5 rounded-full font-medium" style={{ fontFamily: 'Inter, sans-serif' }}>+ Add Item</button>
              </div>
              {/* Stats */}
              <div className="grid grid-cols-4 gap-3 mb-5">
                {stats.map((s) => (
                  <div key={s.label} className="border border-amber-200/60 rounded-xl p-3 bg-white/70">
                    <div className="text-[11px] text-amber-900/40 mb-1" style={{ fontFamily: 'Inter, sans-serif' }}>{s.label}</div>
                    <div className="text-[18px] font-bold text-[#1a1a1a] leading-none mb-1">{s.value}</div>
                    <div className={`text-[11px] font-medium flex items-center gap-0.5 ${s.up ? 'text-[#2d5a27]' : 'text-red-600'}`} style={{ fontFamily: 'Inter, sans-serif' }}>
                      {s.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {s.change}
                    </div>
                  </div>
                ))}
              </div>
              {/* Table */}
              <div className="border border-amber-200/60 rounded-xl overflow-hidden bg-white/70">
                <div className="grid grid-cols-4 text-[11px] font-semibold text-amber-900/30 uppercase tracking-wider px-4 py-2.5 bg-amber-50/60 border-b border-amber-100/80" style={{ fontFamily: 'Inter, sans-serif' }}>
                  <span className="col-span-2">Item</span>
                  <span className="text-right">Buy / Sell</span>
                  <span className="text-right">Score</span>
                </div>
                {items.map((item) => (
                  <div key={item.name} className="grid grid-cols-4 px-4 py-3 border-b border-amber-100/50 last:border-0 items-center hover:bg-amber-50/40 transition-colors">
                    <div className="col-span-2">
                      <div className="text-[13px] font-semibold text-[#1a1a1a]">{item.name}</div>
                      <div className="text-[11px] text-amber-900/35" style={{ fontFamily: 'Inter, sans-serif' }}>{item.platform}</div>
                    </div>
                    <div className="text-right" style={{ fontFamily: 'Inter, sans-serif' }}>
                      <span className="text-[12px] text-amber-900/40">{item.buy}</span>
                      <span className="text-amber-300 mx-1">→</span>
                      <span className="text-[12px] font-semibold text-[#1a1a1a]">{item.sell}</span>
                    </div>
                    <div className="text-right">
                      <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full ${item.score >= 85 ? 'bg-[#2d5a27]/10 text-[#2d5a27]' : 'bg-amber-100 text-amber-900/50'}`} style={{ fontFamily: 'Inter, sans-serif' }}>
                        {item.score}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>

        <p className="text-center text-gray-400 text-xs mt-8">These are representative previews — the full app will be fully themed to match your chosen direction.</p>
      </div>
    </div>
  );
}
