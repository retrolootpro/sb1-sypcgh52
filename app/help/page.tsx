'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { manualFaq, manualSections, workflowGuides } from '@/lib/help-content';
import { BookOpen, ChevronRight, Compass, HelpCircle, Search } from 'lucide-react';

const categories = ['All', ...Array.from(new Set(manualSections.map((section) => section.category)))];

export default function HelpPage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');

  const filteredSections = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return manualSections.filter((section) => {
      const matchesCategory = category === 'All' || section.category === category;
      const haystack = [
        section.title,
        section.category,
        section.summary,
        section.why,
        ...section.steps,
        ...(section.fields || []),
        ...(section.warnings || []),
      ].join(' ').toLowerCase();
      return matchesCategory && (!normalized || haystack.includes(normalized));
    });
  }, [category, query]);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
        <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-end">
          <div>
            <div className="label-caps mb-1">Support</div>
            <h1 className="heading-xl text-white/90">Help / User Manual</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Plain-English operating instructions for RetroLootPro. Use this when training someone, checking what a field means, or deciding the next step in the business workflow.
            </p>
          </div>
          <div className="rounded-2xl border border-primary/20 bg-primary/[0.06] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Compass className="h-4 w-4" />
              Start Here
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              New day: Dashboard, Finance, Tasks, Aging Inventory. New buy: Lot Analyzer, Safe Buying Budget, then Inventory Intake.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/45" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search manual, fields, warnings, or workflows..."
              className="h-11 rounded-xl border-border/50 bg-card pl-9 text-sm"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 md:max-w-[520px]">
            {categories.map((item) => (
              <Button
                key={item}
                size="sm"
                variant={category === item ? 'default' : 'outline'}
                className="h-10 whitespace-nowrap rounded-xl text-xs"
                onClick={() => setCategory(item)}
              >
                {item}
              </Button>
            ))}
          </div>
        </div>

        <section className="rounded-2xl border border-border/40 bg-card p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Step-by-Step Guides</h2>
              <p className="mt-1 text-xs text-muted-foreground">Common workflows for daily use, buying, listing, shows, finance, and disputes.</p>
            </div>
            <Badge variant="outline" className="border-primary/30 text-primary">{workflowGuides.length} guides</Badge>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {workflowGuides.map((guide) => (
              <a key={guide.id} href={`#${guide.id}`} className="rounded-xl border border-border/35 bg-secondary/15 p-4 transition-colors hover:border-primary/25 hover:bg-primary/[0.04]">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">{guide.title}</div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/45" />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{guide.summary}</p>
              </a>
            ))}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <aside className="h-fit rounded-2xl border border-border/40 bg-card p-3 lg:sticky lg:top-4">
            <div className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold text-white/80">
              <BookOpen className="h-4 w-4 text-primary" />
              Manual Sections
            </div>
            <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
              {filteredSections.map((section) => (
                <a key={section.id} href={`#${section.id}`} className="block rounded-lg px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-white/80">
                  {section.title}
                </a>
              ))}
            </div>
          </aside>

          <main className="space-y-4">
            {workflowGuides.map((guide) => (
              <section key={guide.id} id={guide.id} className="scroll-mt-4 rounded-2xl border border-border/40 bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Badge variant="outline" className="mb-3 border-primary/30 text-primary">Workflow</Badge>
                    <h2 className="text-lg font-semibold text-white/90">{guide.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{guide.summary}</p>
                  </div>
                </div>
                <ol className="mt-4 space-y-2">
                  {guide.steps.map((step, index) => (
                    <li key={step} className="flex gap-3 rounded-xl border border-border/25 bg-secondary/10 p-3 text-sm text-muted-foreground">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{index + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}

            {filteredSections.length === 0 ? (
              <div className="rounded-2xl border border-border/40 bg-card py-16 text-center">
                <HelpCircle className="mx-auto mb-3 h-9 w-9 text-muted-foreground/30" />
                <h3 className="text-sm font-semibold">No manual sections found</h3>
                <p className="mt-1 text-xs text-muted-foreground">Try a different search term or category.</p>
              </div>
            ) : (
              filteredSections.map((section) => {
                const Icon = section.icon;
                return (
                  <section key={section.id} id={section.id} className="scroll-mt-4 rounded-2xl border border-border/40 bg-card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="rounded-xl border border-primary/20 bg-primary/10 p-2">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <Badge variant="outline" className="mb-2 border-border/60 text-muted-foreground">{section.category}</Badge>
                          <h2 className="text-lg font-semibold text-white/90">{section.title}</h2>
                          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{section.summary}</p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 rounded-xl border border-border/25 bg-secondary/10 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wider text-white/50">Why it matters</div>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{section.why}</p>
                    </div>
                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">How to use it</div>
                        <ol className="space-y-2">
                          {section.steps.map((step, index) => (
                            <li key={`${section.id}-${step}`} className="flex gap-3 text-sm text-muted-foreground">
                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[11px] text-white/60">{index + 1}</span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div className="space-y-4">
                        {section.fields && (
                          <div>
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">Fields explained</div>
                            <div className="space-y-2">
                              {section.fields.map((field) => (
                                <div key={field} className="rounded-lg border border-border/25 bg-secondary/10 px-3 py-2 text-xs text-muted-foreground">{field}</div>
                              ))}
                            </div>
                          </div>
                        )}
                        {section.warnings && (
                          <div>
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-300/80">Warnings</div>
                            <div className="space-y-2">
                              {section.warnings.map((warning) => (
                                <div key={warning} className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/80">{warning}</div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                );
              })
            )}

            <section className="rounded-2xl border border-border/40 bg-card p-5">
              <h2 className="text-lg font-semibold text-white/90">FAQ</h2>
              <div className="mt-4 space-y-3">
                {manualFaq.map((item) => (
                  <div key={item.question} className="rounded-xl border border-border/25 bg-secondary/10 p-4">
                    <div className="text-sm font-semibold">{item.question}</div>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.answer}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="rounded-2xl border border-primary/20 bg-primary/[0.05] p-4 text-sm text-muted-foreground">
              Need the assistant? Ask it questions in <Link href="/assistant" className="text-primary hover:underline">AI Assistant</Link>, but use this manual as the source of truth for workflow meaning and status definitions.
            </div>
          </main>
        </div>
      </div>
    </DashboardLayout>
  );
}
