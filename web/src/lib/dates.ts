import { format, parse } from 'date-fns';
import { enUS, es } from 'date-fns/locale';

export const dateFnsLocale = (lng: string) => (lng.startsWith('en') ? enUS : es);

/** Today's date key in the user's local timezone. */
export const todayKey = () => format(new Date(), 'yyyy-MM-dd');

/** Parse a YYYY-MM-DD key as a local date (midnight local time). */
export const parseDateKey = (dateKey: string) => parse(dateKey, 'yyyy-MM-dd', new Date());

export const toDateKey = (date: Date) => format(date, 'yyyy-MM-dd');

export const formatDateKey = (dateKey: string, lng: string, pattern = 'PPPP') =>
  format(parseDateKey(dateKey), pattern, { locale: dateFnsLocale(lng) });
