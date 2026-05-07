export const DEFAULT_STALE_INVENTORY_DAYS = 60;
export const STALE_INVENTORY_DAYS_KEY = 'retroloot.staleInventoryDays';

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

export function readStaleThresholdDays() {
  if (typeof window === 'undefined') return DEFAULT_STALE_INVENTORY_DAYS;
  return normalizeStaleThreshold(window.localStorage.getItem(STALE_INVENTORY_DAYS_KEY));
}

export function writeStaleThresholdDays(days: number) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STALE_INVENTORY_DAYS_KEY, String(normalizeStaleThreshold(days)));
  window.dispatchEvent(new Event('retroloot-stale-threshold-change'));
}

export function getAgeStatus(ageDays: number, thresholdDays: number) {
  const safeThreshold = normalizeStaleThreshold(thresholdDays);
  if (ageDays >= safeThreshold) return 'stale';
  if (ageDays >= Math.max(1, Math.floor(safeThreshold * 0.75))) return 'watch';
  return 'fresh';
}

export function getAgeActionLabel(ageDays: number, thresholdDays: number) {
  const status = getAgeStatus(ageDays, thresholdDays);
  if (status === 'stale') return 'Review price/listing';
  if (status === 'watch') return 'Watch soon';
  return 'In stock';
}
