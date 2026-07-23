'use client';

import { useEffect, useState } from 'react';
import { Check, Moon, Sparkles, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ThemeMode = 'dark' | 'light' | 'apple';

const THEME_STORAGE_KEY = 'retroloot-theme';
const THEME_CHANGE_EVENT = 'retroloot-theme-change';

const themeOptions: Array<{
  value: ThemeMode;
  label: string;
  description: string;
  icon: typeof Moon;
}> = [
  {
    value: 'dark',
    label: 'Retro Dark',
    description: 'Neon command center',
    icon: Moon,
  },
  {
    value: 'light',
    label: 'Soft Light',
    description: 'Calmer daily operations',
    icon: Sun,
  },
  {
    value: 'apple',
    label: 'Studio',
    description: 'Apple-inspired system UI',
    icon: Sparkles,
  },
];

export function normalizeTheme(value: string | null): ThemeMode {
  return value === 'light' || value === 'apple' ? value : 'dark';
}

export function applyTheme(mode: ThemeMode) {
  document.documentElement.classList.toggle('light', mode === 'light');
  document.documentElement.classList.toggle('apple', mode === 'apple');
  document.documentElement.style.colorScheme = mode === 'dark' ? 'dark' : 'light';
}

function readStoredTheme() {
  return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
}

function saveTheme(mode: ThemeMode) {
  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  applyTheme(mode);
  window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_CHANGE_EVENT, { detail: mode }));
}

function useSyncedTheme() {
  const [mode, setMode] = useState<ThemeMode>('dark');

  useEffect(() => {
    const stored = readStoredTheme();
    setMode(stored);
    applyTheme(stored);

    const handleThemeChange = (event: Event) => {
      setMode(normalizeTheme((event as CustomEvent<ThemeMode>).detail));
    };

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
  }, []);

  return [mode, setMode] as const;
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useSyncedTheme();

  const nextMode = mode === 'dark' ? 'light' : mode === 'light' ? 'apple' : 'dark';
  const Icon = nextMode === 'apple' ? Sparkles : nextMode === 'light' ? Sun : Moon;

  return (
    <Button
      type="button"
      variant="outline"
      size={compact ? 'icon' : 'sm'}
      className={compact ? 'h-11 w-11' : 'h-11 w-full justify-start gap-2 text-sm'}
      style={compact ? { minHeight: 44, minWidth: 44 } : { minHeight: 44 }}
      onClick={() => {
        setMode(nextMode);
        saveTheme(nextMode);
      }}
      aria-label={`Switch to ${nextMode} theme`}
    >
      <Icon className="h-4 w-4" />
      {!compact && <span>{nextMode === 'light' ? 'Light Theme' : nextMode === 'apple' ? 'Studio Theme' : 'Dark Theme'}</span>}
    </Button>
  );
}

export function ThemeSwitcher({ className }: { className?: string }) {
  const [mode, setMode] = useSyncedTheme();

  return (
    <div className={cn('grid gap-3 sm:grid-cols-3', className)}>
      {themeOptions.map((option) => {
        const Icon = option.icon;
        const active = mode === option.value;

        return (
          <button
            key={option.value}
            type="button"
            className={cn(
              'group relative min-h-36 rounded-2xl border p-4 text-left transition-all',
              active
                ? 'border-primary/45 bg-primary/[0.09] shadow-[0_18px_44px_-34px_hsl(var(--primary)/0.8)]'
                : 'border-border/50 bg-secondary/25 hover:border-primary/30 hover:bg-secondary/45'
            )}
            onClick={() => {
              setMode(option.value);
              saveTheme(option.value);
            }}
            aria-pressed={active}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border/60 bg-background/70">
                <Icon className={cn('h-5 w-5', active ? 'text-primary' : 'text-muted-foreground')} />
              </div>
              {active && (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-4 w-4" />
                </div>
              )}
            </div>
            <div className="mt-5 text-sm font-semibold text-foreground">{option.label}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</div>
          </button>
        );
      })}
    </div>
  );
}
