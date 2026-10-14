/** JST の日付（yyyy-mm-dd） */
export function jstDay(d: Date = new Date()): string {
  return new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
}
