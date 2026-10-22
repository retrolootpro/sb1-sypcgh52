export function parseIntakeMoney(raw: string): number | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter a nonnegative amount with up to two decimals.');
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount > 100000) throw new Error('Amount must be no more than $100,000.');
  return amount;
}

export function lotCostFinalized(lot: { allocation_status?: string | null; cost_allocated_at?: string | null } | null) {
  return !!lot && (lot.allocation_status === 'allocated' || (!lot.allocation_status && !!lot.cost_allocated_at));
}
