import { addDays, format, parse, type Locale } from 'date-fns';
import { enUS, es, it, ja, zhCN } from 'date-fns/locale';
import { resolveLanguage } from '@/i18n';

/* One date-fns locale per shipped language, keyed by the same codes as LANGUAGES. Anything
   regional ("zh-CN", "it-CH") folds to its base through resolveLanguage — the same function the
   language picker uses — so month and weekday names always follow the UI language. */
const LOCALES: Record<string, Locale> = { en: enUS, es, it, ja, zh: zhCN };

export const dateFnsLocale = (lng: string): Locale => LOCALES[resolveLanguage(lng)] ?? es;

/** Day index a week can start on. The Settings picker offers Sunday and Monday (plus 'auto');
    6 exists because a date-fns locale is allowed to report Saturday, and localeWeekStart passes
    through whatever the locale says rather than second-guessing it. */
export type WeekStart = 0 | 1 | 6;

/** What the language itself considers the first day: Sunday for en/ja, Monday for es/it/zh. */
export const localeWeekStart = (lng: string): WeekStart =>
  (dateFnsLocale(lng).options?.weekStartsOn ?? 1) as WeekStart;

/** Turns the stored preference into a concrete day index, resolving 'auto' against the language. */
export const resolveWeekStart = (preference: WeekStart | 'auto', lng: string): WeekStart =>
  preference === 'auto' ? localeWeekStart(lng) : preference;

/** Upper-cases the first character only. Spanish and Italian render month and weekday names in
    lowercase ("lunes", "marzo"), which is right mid-sentence and wrong when the name stands on
    its own as a heading or an option. A no-op on Japanese and Chinese. */
export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/* 7 January 2024 was a Sunday. Anchoring on a known one is what lets a day *index* be named in
   any locale without hardcoding a list of weekdays per language. */
const SUNDAY = new Date(2024, 0, 7);

/** Name of a weekday by index (0 = Sunday), in the given language. 'EEEEEE' gives the short
    two-letter form used as a column header. Lowercase in several languages — capitalise in CSS. */
export const weekdayName = (day: number, lng: string, pattern: 'EEEE' | 'EEEEEE' = 'EEEE') =>
  format(addDays(SUNDAY, day), pattern, { locale: dateFnsLocale(lng) });

/** Today's date key in the user's local timezone. */
export const todayKey = () => format(new Date(), 'yyyy-MM-dd');

/** Parse a YYYY-MM-DD key as a local date (midnight local time). */
export const parseDateKey = (dateKey: string) => parse(dateKey, 'yyyy-MM-dd', new Date());

export const toDateKey = (date: Date) => format(date, 'yyyy-MM-dd');

export const formatDateKey = (dateKey: string, lng: string, pattern = 'PPPP') =>
  format(parseDateKey(dateKey), pattern, { locale: dateFnsLocale(lng) });
