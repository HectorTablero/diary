import type { EntryDto } from '@diary/shared';
import { Check, ChevronDown, ChevronRight, GitBranch } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntryContent } from '@/components/entry/EntryContent';
import { ImportanceDot } from '@/components/entry/ImportanceDot';
import { TagChip } from '@/components/entry/chips';
import { Button } from '@/components/ui/button';
import { formatDateKey } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { DemoCard } from '../DemoCard';
import { demoData } from '../demoData';

/**
 * One member entry of the demo thread, shaped like the rows on the threads page.
 *
 * Not `EntryRow`'s: the real page shows its date as an ungated `<Link>` to `/diary/<day>`, which
 * has no business in a tour whose demo is contained (nothing may navigate out of it). The date is
 * the whole point of a thread — entries across many days gathered under one topic — so it is drawn
 * here as plain text instead, using the same `formatDateKey` call and classes the real row does.
 * Everything else (the importance dot, the highlighted `#project` token) runs through the same
 * components the diary uses, wrapped in the demo card so the token can't turn into a link.
 */
function ThreadEntryRow({ entry, crossedOut }: { entry: EntryDto; crossedOut?: boolean }) {
  const { i18n } = useTranslation();
  return (
    <li className="flex items-start gap-2.5">
      <ImportanceDot importance={entry.importance} className="mt-2" />
      <div className="min-w-0 flex-1">
        <EntryContent
          entry={entry}
          className={cn(crossedOut && 'text-muted-foreground line-through')}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {formatDateKey(entry.dateKey, i18n.language, 'd MMM yyyy')}
        </p>
      </div>
    </li>
  );
}

/**
 * The last web step: entries can point at the same topic across many days.
 *
 * Two views, like the people step's two panels — side by side on `lg`, stacked on mobile. The first
 * is the real threads page: a "Threads" header (with a count that says six, so it reads as a page of
 * many), the "Diary project" row with its entry count, and underneath the four days that belong to
 * it. The second is that connection surfacing on a person's profile — someone the tour hasn't met,
 * whose talking points arrive grouped under the same thread's header, entries and all.
 *
 * The profile card matches the real `PersonProfilePage`'s `PersonIdentity` component — the large
 * round monogram, the name as a heading, tag chips, and a tab bar with the active tab highlighted —
 * so the user recognises it immediately when they see the real page later.
 *
 * The "Mark all as said" button is a live toggle (like PeopleStep's "Mark as said"), crossing out
 * the entries when pressed and toggling back when pressed again.
 */
export function ThreadsStep() {
  const { t, i18n } = useTranslation();
  const demo = useMemo(() => demoData(t), [t, i18n.language]);
  const [said, setSaid] = useState(false);

  return (
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center lg:gap-4">
      {/* The threads page itself. */}
      <DemoCard className="bg-background p-3">
        <div className="mb-2.5 flex items-center gap-2">
          <h3 className="font-heading text-base font-semibold">{t('threads.title')}</h3>
          {/* Six threads, one shown — the same "there are more of these" as the people list's 276. */}
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-muted text-[12px] font-medium text-muted-foreground">
            <span className="sr-only">{t('threads.count', { count: 6 })}</span>
            <span className="px-2">6</span>
          </span>
        </div>

        {/* The thread row, drawn like the real page's `ThreadRow` but with every control taken out. */}
        <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs">
          <GitBranch aria-hidden className="size-4 shrink-0 text-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-foreground">{demo.thread.name}</p>
            <p className="text-xs text-muted-foreground">
              {t('threads.entriesCount', { count: demo.threadEntries.length })}
            </p>
          </div>
          {/* Pointing up = the thread is shown expanded, which is how the members below read. */}
          <ChevronDown aria-hidden className="size-4 rotate-180 text-muted-foreground" />
        </div>

        {/* Member list, matching the real page's own `border-l pl-3` framing. */}
        <ul className="mt-2 flex flex-col gap-1.5 border-l pl-3">
          {demo.threadEntries.map((entry) => (
            <ThreadEntryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      </DemoCard>

      {/* The two panels are one screen and the screen after it; this is the tap between them. */}
      <ChevronRight
        aria-hidden
        className="mx-auto size-4 shrink-0 -rotate-90 text-muted-foreground lg:rotate-0"
      />

      {/* The same thread seen on a person's profile, matching the real PersonProfilePage's layout. */}
      <DemoCard className="bg-background p-3">
        {/* PersonIdentity — matches the real component's `size-14` monogram + name + tags. */}
        <div className="mb-4 flex items-start gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary uppercase">
            {demo.profilePerson.name.slice(0, 2)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-semibold tracking-tight">
              {demo.profilePerson.name}
            </p>
            {/* Tag chips: projectTag and one from otherTags. */}
            <div className="mt-1.5 flex flex-wrap gap-1">
              <TagChip tag={demo.projectTag} />
              <TagChip tag={demo.otherTags[0]} />
            </div>
          </div>
        </div>

        {/* Drawn like the real `TalkingPointGroup`: a thread header binding one person's rows. The
            "Mark all" button is a live toggle, matching PeopleStep's pattern. */}
        <section className="rounded-xl border border-foreground/20 bg-muted/30 p-1.5">
          <header className="flex items-center gap-2 px-1.5 pt-0.5 pb-1.5">
            <GitBranch aria-hidden className="size-3.5 shrink-0 text-foreground" />
            <h4 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
              {demo.thread.name}
            </h4>
            <span className="shrink-0 text-xs text-muted-foreground">
              {t('threads.toTell', { count: demo.threadEntries.length })}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1 px-2 text-xs"
              aria-pressed={said}
              onClick={() => setSaid((was) => !was)}
            >
              <Check className="size-3.5" />
              {said ? t('people.markedSaid') : t('threads.markAllSaid')}
            </Button>
          </header>
          <ul className="flex flex-col gap-2">
            {demo.threadEntries.map((entry) => (
              <ThreadEntryRow key={entry.id} entry={entry} crossedOut={said} />
            ))}
          </ul>
        </section>
      </DemoCard>
    </div>
  );
}
