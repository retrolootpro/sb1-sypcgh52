export function financePeriodBounds(year: number, month?: number) {
  if (!Number.isInteger(year) || year < 1900 || year > 9998 ||
    (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12))) {
    throw new Error('Choose a valid reporting year and month.');
  }
  const startDate = `${year}-${String(month ?? 1).padStart(2, '0')}-01`;
  const nextYear = month === undefined || month === 12 ? year + 1 : year;
  const nextMonth = month === undefined || month === 12 ? 1 : month + 1;
  const endExclusive = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const endDate = new Date(Date.parse(`${endExclusive}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  return { startDate, endDate, endExclusive };
}

export function financeCsv(rows: (string | number)[][]) {
  return rows.map(row => row.map(cell => {
    const text = String(cell);
    const safe = /^[\s]*[=+@-]/.test(text) && typeof cell === 'string' ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
}
