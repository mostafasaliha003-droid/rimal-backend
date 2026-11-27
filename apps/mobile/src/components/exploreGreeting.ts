/**
 * The line above Explore's question: the time of day and, when we know it, the member's first name.
 * Morning runs 05:00–11:59; Arabic has no separate afternoon greeting, so it says مساء الخير after noon.
 */
export function exploreGreeting(hour: number, language: 'ar' | 'en', name?: string | null): string {
  const morning = hour >= 5 && hour < 12;
  const phrase = language === 'ar'
    ? (morning ? 'صباح الخير' : 'مساء الخير')
    : (morning ? 'Good morning' : hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good evening');
  const first = typeof name === 'string' ? name.trim().split(/\s+/)[0]?.slice(0, 40) : '';
  if (!first) return phrase;
  return language === 'ar' ? `${phrase}، ${first}` : `${phrase}, ${first}`;
}
