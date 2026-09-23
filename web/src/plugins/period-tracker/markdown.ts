import { db } from '@/db/db';
import i18n from '@/i18n';
import { inExportRange } from '@/plugins/markdown';
import type { PluginExportRange } from '@/plugins/types';
import { parsePeriodDay, type PeriodDay } from './model';

/**
 * The period log, as a Markdown table: one row per marked day inside the export's range, its flow
 * beside it.
 *
 * Same shape as habits.md, and the same reason only marked days appear: a missing row means nothing
 * was recorded, not that nothing happened, and filling the gaps in would claim a certainty this
 * plugin does not have.
 *
 * Every row this plugin keeps is a day row — there is no definition collection describing a longer
 * period, the way habits has one — so honouring the range is the whole of the work here, and a
 * range with no marked day in it produces no section at all rather than an empty table.
 */
export async function exportPeriodMarkdown(
  range: PluginExportRange,
): Promise<{ filename: string; markdown: string }[]> {
  const rows = await db.pluginRecords.where('pluginId').equals('period-tracker').toArray();

  const days = rows
    .filter((row) => inExportRange(row.dateKey, range))
    .flatMap((row) => {
      const parsed = parsePeriodDay(row);
      return parsed ? [[row.dateKey, parsed] as [string, PeriodDay]] : [];
    })
    .sort(([a], [b]) => a.localeCompare(b));
  if (!days.length) return [];

  const flowLabel = (day: PeriodDay) =>
    i18n.t(`plugins.period-tracker.flow${day.flow.charAt(0).toUpperCase()}${day.flow.slice(1)}`);

  const header = `| ${i18n.t('plugins.period-tracker.dateColumn')} | ${i18n.t('plugins.period-tracker.flowColumn')} |`;
  const divider = '| --- | --- |';
  const body = days.map(([dateKey, day]) => `| ${dateKey} | ${flowLabel(day)} |`);

  return [
    {
      filename: 'period-tracker.md',
      markdown: [`## ${i18n.t('plugins.period-tracker.title')}`, '', header, divider, ...body].join(
        '\n',
      ),
    },
  ];
}
