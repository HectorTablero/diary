import en from '@/i18n/locales/en.json';

const LEVELS = ['1', '2', '3', '4', '5'] as const;

/** Importance-scale legend (1 = most important .. 5 = least), sourced from the English i18n
    strings regardless of the app's current display language — these exports are meant for an
    agent, so they stay in one consistent language rather than following whatever locale the
    user happens to have the app set to. */
export function buildImportanceLegend(): string {
  const lines: string[] = ['## Importance scale', ''];
  for (const level of LEVELS) {
    lines.push(`- **${level} — ${en.importance.levels[level]}**: ${en.importance.descriptions[level]}`);
  }
  lines.push('');
  return lines.join('\n');
}
