export function formatCount(count: number, intlLocale: string): string {
  return count.toLocaleString(intlLocale);
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

export function formatDate(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

/** 取り込みの記録はUTCで持っているので、見る人の地域の時刻で出す。 */
export function formatUtcDateTime(value: string | null, intlLocale: string): string {
  if (!value) return '';
  return new Intl.DateTimeFormat(intlLocale, { dateStyle: 'short', timeStyle: 'medium' }).format(
    new Date(`${value.replace(' ', 'T')}Z`),
  );
}
