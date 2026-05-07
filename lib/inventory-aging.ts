export const DEFAULT_STALE_INVENTORY_DAYS = 60;
export const DEFAULT_WATCH_INVENTORY_DAYS = 45;
export const STALE_INVENTORY_DAYS_KEY = 'retroloot.staleInventoryDays';
export const WATCH_INVENTORY_DAYS_KEY = 'retroloot.watchInventoryDays';

export type AgingThresholds = {
  watchDays: number;
  reviewDays: number;
};

export function getInventoryAgeDays(createdAt?: string | null) {
  if (!createdAt) return 0;
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, Math.floor((Date.now() - created) / 86400000));
}

export function normalizeStaleThreshold(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_STALE_INVENTORY_DAYS;
  return Math.max(1, Math.min(365, Math.round(parsed)));
}

export function normalizeAgingThresholds(value: Partial<AgingThresholds>) {
  const reviewDays = normalizeStaleThreshold(value.reviewDays);
  const rawWatch = normalizeStaleThreshold(value.watchDays);
  const watchDays = Math.max(1, Math.min(reviewDays, rawWatch));
  return { watchDays, reviewDays };
}

export function readAgingThresholds(): AgingThresholds {
  if (typeof window === 'undefined') {
    return { watchDays: DEFAULT_WATCH_INVENTORY_DAYS, reviewDays: DEFAULT_STALE_INVENTORY_DAYS };
  }
  const reviewDays = normalizeStaleThreshold(window.localStorage.getItem(STALE_INVENTORY_DAYS_KEY));
  const savedWatch = window.localStorage.getItem(WATCH_INVENTORY_DAYS_KEY);
  const watchDays = savedWatch == null
    ? Math.max(1, Math.min(reviewDays, Math.floor(reviewDays * 0.75)))
    : normalizeStaleThreshold(savedWatch);
  return normalizeAgingThresholds({ watchDays, reviewDays });
}

export function writeAgingThresholds(thresholds: Partial<AgingThresholds>) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeAgingThresholds({
    watchDays: thresholds.watchDays ?? readAgingThresholds().watchDays,
    reviewDays: thresholds.reviewDays ?? readAgingThresholds().reviewDays,
  });
  window.localStorage.setItem(WATCH_INVENTORY_DAYS_KEY, String(normalized.watchDays));
  window.localStorage.setItem(STALE_INVENTORY_DAYS_KEY, String(normalized.reviewDays));
  window.dispatchEvent(new Event('retroloot-stale-threshold-change'));
}

export function readStaleThresholdDays() {
  if (typeof window === 'undefined') return DEFAULT_STALE_INVENTORY_DAYS;
  return readAgingThresholds().reviewDays;
}

export function writeStaleThresholdDays(days: number) {
  if (typeof window === 'undefined') return;
  writeAgingThresholds({ reviewDays: days });
}

export function getAgeStatus(ageDays: number, threshold: number | AgingThresholds) {
  const thresholds = typeof threshold === 'number'
    ? normalizeAgingThresholds({ watchDays: Math.floor(threshold * 0.75), reviewDays: threshold })
    : normalizeAgingThresholds(threshold);
  if (ageDays >= thresholds.reviewDays) return 'stale';
  if (ageDays >= thresholds.watchDays) return 'watch';
  return 'fresh';
}

export function getAgeActionLabel(ageDays: number, threshold: number | AgingThresholds) {
  const status = getAgeStatus(ageDays, threshold);
  if (status === 'stale') return 'Review price/listing';
  if (status === 'watch') return 'Watch soon';
  return 'In stock';
}
