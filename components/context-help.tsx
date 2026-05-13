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
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/10 text-white/35 transition-colors hover:border-primary/35 hover:text-primary"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </Link>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
