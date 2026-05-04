import { REGIONS } from './constants';

export type RegionValue = (typeof REGIONS)[number]['value'];

export type RegionDetails = {
  value: RegionValue;
  label: string;
  shortLabel: string;
};

type RegionInput = {
  region?: string | null;
  product_name?: string | null;
  console?: string | null;
  description?: string | null;
  pricing_matched_title?: string | null;
  pricing_matched_platform?: string | null;
};

function matchRegion(value?: string | null): RegionDetails | null {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return null;
  return REGIONS.find((item) => item.value === normalized) ?? null;
}

export function detectRegionFromText(...values: Array<string | null | undefined>): RegionDetails | null {
  const text = values
    .filter(Boolean)
    .join(' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return null;
  const upper = text.toUpperCase();

  if (/\b(PAL|EU|EUR|EUROPE|EUROPEAN|UK|AU|AUS|AUSTRALIA|AUST)\b/.test(upper)) {
    return REGIONS.find((item) => item.value === 'PAL') ?? null;
  }

  if (/\b(JP|JPN|JAPAN|JAPANESE|NTSC-J)\b/.test(upper)) {
    return REGIONS.find((item) => item.value === 'JP') ?? null;
  }

  if (/\b(US|USA|U\.S\.|NTSC-U|NTSC-US|NTSC U\/C|NORTH AMERICA|AMERICAN)\b/.test(upper)) {
    return REGIONS.find((item) => item.value === 'US') ?? null;
  }

  return null;
}

export function getItemRegionDetails(item: RegionInput): RegionDetails | null {
  return (
    matchRegion(item.region) ||
    detectRegionFromText(
      item.product_name,
      item.pricing_matched_title,
      item.console,
      item.pricing_matched_platform,
      item.description
    )
  );
}

export function getRegionStyle(region?: RegionDetails | null) {
  switch (region?.value) {
    case 'US': return 'bg-blue-500/15 text-blue-300 border-blue-400/40';
    case 'JP': return 'bg-pink-500/15 text-pink-300 border-pink-400/40';
    case 'PAL': return 'bg-violet-500/15 text-violet-300 border-violet-400/40';
    default: return 'bg-muted text-muted-foreground border-border/60';
  }
}
