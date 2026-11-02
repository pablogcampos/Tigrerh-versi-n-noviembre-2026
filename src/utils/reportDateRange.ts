// Training start is the common date for every export; compare calendar days without UTC conversion.
export function matchesReportDateRange(date: string | undefined, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (from && to && from > to) return false;
  const day = date?.slice(0, 10) || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return false;
  return (!from || day >= from) && (!to || day <= to);
}
