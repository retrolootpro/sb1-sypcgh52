'use client';

import Link from 'next/link';
import { HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function ContextHelp({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={href}
            aria-label={label}
            style={{ minHeight: 36, minWidth: 36 }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/45 transition-colors hover:border-primary/35 hover:text-primary"
          >
            <HelpCircle className="h-4 w-4" />
          </Link>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
