export type Rating = 'again' | 'hard' | 'remember' | 'easy';
export function ratingOf(value: boolean | Rating): Rating { return typeof value === 'boolean' ? value ? 'remember' : 'again' : value; }
export function scheduleRating(interval: number, value: boolean | Rating, now = Date.now()) {
  const rating = ratingOf(value);
  const calculated = rating === 'again' ? 0 : rating === 'hard' ? Math.max(1, Math.ceil(interval * 1.2)) : rating === 'easy' ? Math.max(3, Math.ceil(interval * 3)) : Math.max(1, interval * 2);
  const next=Math.min(36500,calculated);
  return { interval: next, due: now + (rating === 'again' ? 60000 : next * 86400000) };
}
