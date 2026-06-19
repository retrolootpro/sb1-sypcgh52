'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ThemeMode = 'dark' | 'light';

function applyTheme(mode: ThemeMode) {
  document.documentElement.classList.toggle('light', mode === 'light');
  document.documentElement.style.colorScheme = mode;
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useState<ThemeMode>('dark');

  useEffect(() => {
    const stored = window.localStorage.getItem('retroloot-theme') === 'light' ? 'light' : 'dark';
    setMode(stored);
    applyTheme(stored);
  }, []);

  const nextMode = mode === 'light' ? 'dark' : 'light';
  const Icon = mode === 'light' ? Moon : Sun;

  return (
    <Button
      type="button"
      variant="outline"
      size={compact ? 'icon' : 'sm'}
      className={compact ? 'h-11 w-11' : 'h-11 w-full justify-start gap-2 text-sm'}
      style={compact ? { minHeight: 44, minWidth: 44 } : { minHeight: 44 }}
      onClick={() => {
        setMode(nextMode);
        window.localStorage.setItem('retroloot-theme', nextMode);
        applyTheme(nextMode);
      }}
      aria-label={`Switch to ${nextMode} mode`}
    >
      <Icon className="h-4 w-4" />
      {!compact && <span>{mode === 'light' ? 'Dark Mode' : 'Light Mode'}</span>}
    </Button>
  );
}
