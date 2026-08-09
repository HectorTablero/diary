import { AtSign, CornerDownRight, Hash } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DemoCard, DemoEntry } from '../DemoCard';
import { demoData } from '../demoData';

function Rule({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span aria-hidden className="mt-0.5 shrink-0 text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/**
 * What an entry is, and the two characters that make it more than a note.
 *
 * The demo entry is shown *rendered* rather than as "type this → get that". `EntryContent` keeps
 * the literal `@` and `#` in the highlighted token, so one card shows both the thing you type and
 * what the app does with it — a before/after pair would take twice the height to say the same
 * thing, and the sub-entries below it are the part that needs the room.
 */
export function WritingStep() {
  const { t, i18n } = useTranslation();
  // Recomputed when the language changes — step 1 is the language picker, so this is not
  // hypothetical. See the note in demoData.ts.
  const demo = useMemo(() => demoData(t), [t, i18n.language]);

  return (
    <div className="flex flex-col gap-4">
      <DemoCard>
        <DemoEntry entry={demo.entry} />
      </DemoCard>
      <ul className="flex flex-col gap-2.5">
        <Rule icon={<AtSign className="size-4" />}>{t('onboarding.writing.person')}</Rule>
        <Rule icon={<Hash className="size-4" />}>{t('onboarding.writing.tag')}</Rule>
        <Rule icon={<CornerDownRight className="size-4" />}>
          {t('onboarding.writing.subEntries')}
        </Rule>
      </ul>
    </div>
  );
}
