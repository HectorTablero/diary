import type { EntryDto, PersonRefDto, TagDto } from '@diary/shared';
import { Check, ChevronRight, MessageCircle, Tag as TagIcon } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TagChip } from '@/components/entry/chips';
import { EntryRow } from '@/components/person/EntryRow';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DemoCard } from '../DemoCard';
import { demoData } from '../demoData';

/** The round monogram every person wears in the list and on their profile. */
function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary uppercase',
        className,
      )}
    >
      {name.slice(0, 2)}
    </div>
  );
}

/**
 * A row of the people list, with everything that acts on it taken out.
 *
 * Copied from PeopleListPage's `PersonRow` rather than imported: that one is a `<Link>` with a
 * stretched ::before and a ⋯ menu wired to a mutation, so reusing it would put two live controls
 * for a person who does not exist into a tour. What is being previewed here is the *shape* of the
 * screen — a monogram, a name, its tags, and a count of things worth telling them — so the layout
 * classes are what has to match, and they do.
 */
function PersonPreviewRow({
  person,
  tags,
  talkingPoints,
}: {
  person: PersonRefDto;
  tags: TagDto[];
  talkingPoints?: number;
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <Avatar name={person.name} />
      <div className="min-w-0 flex-1">
        <span className="block max-w-full truncate font-medium">{person.name}</span>
        {tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <TagChip tag={tag} />
            ))}
          </div>
        )}
      </div>
      {talkingPoints !== undefined && (
        <Badge variant="secondary" className="gap-1">
          <MessageCircle className="size-3" />
          {talkingPoints}
        </Badge>
      )}
    </li>
  );
}

/** One card of the talking-points list, matching TalkingPointItem's own chrome. */
function TalkingPointCard({
  entry,
  crossedOut,
  children,
}: {
  entry: EntryDto;
  crossedOut?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card py-1.5 pr-2 pl-3 shadow-xs">
      <EntryRow entry={entry} showChips={false} showDate={false} crossedOut={crossedOut}>
        {children}
      </EntryRow>
    </div>
  );
}

/**
 * The part of the app that isn't a diary, shown as the two screens it actually is.
 *
 * A person's name in an entry is not a label — it puts them on a list, and opening them shows what
 * you have not told them yet. Two stacked previews say that in less space than a paragraph could:
 * the people list with a count beside a name, and the profile you get by tapping it.
 *
 * The list is clipped mid-row rather than scrolled. A scrollable panel inside a tour that is itself
 * swiped sideways is two gestures fighting over one surface; a cut-off second row says "there are
 * more of these" without inviting anyone to try.
 *
 * Every control here is faked. The real `TalkingPointItem` calls `useSetSaid`/`useSetHidden`, which
 * write to Dexie and queue an outbox op — a said-mark for a person who does not exist, on a device
 * that has not signed in yet.
 */
export function PeopleStep() {
  const { t, i18n } = useTranslation();
  const demo = useMemo(() => demoData(t), [t, i18n.language]);
  const [said, setSaid] = useState(false);
  const [expanded, setExpanded] = useState(false);

  /* The sub-entry hangs behind the "+1 hidden" toggle rather than being listed, and that is what
     the real screen would do with it: the parent names the person, so it is the talking point; the
     sub-entry names nobody, so it is context you can open if you want it, not something to say. */
  const [subEntry] = demo.entry.children;

  return (
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center lg:gap-4">
      <DemoCard className="bg-background p-3">
        <div className="mb-2.5 flex items-center gap-2">
          <h3 className="font-heading text-base font-semibold">{t('people.title')}</h3>
          {/* The header count, as on the real page: a pill that says how many people there are. */}
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-muted text-[12px] font-medium text-muted-foreground">
            <span className="sr-only">{t('people.count', { count: 276 })}</span>
            <span className="px-2">276</span>
          </span>
        </div>
        {/* Fixed height and clipped, so the second row is cut through the middle: enough of it to
            read as a person, not enough to read as the end of the list. */}
        <div className="relative max-h-35 overflow-hidden">
          <ul className="flex flex-col gap-2">
            {/* The colleague leads, and it is his profile that opens below. He is never named in
                the entry — he is on this list because he carries the tag it does, which is the
                half of the model a mention alone cannot show. Behind him, half-cut, is somebody
                with no part in the demo at all: a third face is what makes this a list. */}
            <PersonPreviewRow
              person={demo.colleague}
              tags={[demo.tag, demo.otherTags[0]]}
              talkingPoints={1}
            />
            <PersonPreviewRow
              person={demo.otherPerson}
              tags={[demo.otherTags[1], demo.otherTags[2], demo.otherTags[3]]}
              talkingPoints={6}
            />
          </ul>
          {/* Fades the cut edge into the panel rather than slicing a card off mid-border. Matches
              the panel's own `bg-background`, so it disappears into it in either theme, and stays
              shallower than the row it covers — a fade that swallows the whole row reads as an
              empty box rather than as a list continuing. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-background"
          />
        </div>
      </DemoCard>

      {/* The two panels are one screen and the screen after it; this is the tap between them. */}
      <ChevronRight
        aria-hidden
        className="mx-auto size-4 shrink-0 -rotate-90 text-muted-foreground lg:rotate-0"
      />

      <DemoCard className="bg-background p-3">
        <div className="mb-2.5 flex items-center gap-2.5">
          <Avatar name={demo.colleague.name} className="size-9" />
          <div className="min-w-0">
            <p className="truncate font-medium">{demo.colleague.name}</p>
            <p className="text-xs text-muted-foreground">{t('people.talkingPoints')}</p>
          </div>
        </div>

        <ul>
          <li>
            <TalkingPointCard entry={demo.entry} crossedOut={said}>
              {/* EntryRow floats these, so they need no wrapper — same as the real card, including
                  the badge dropping out below `sm`: on a phone the entry's own text needs the width
                  more than the explanation does, and the lede above has already given it. */}
              {/* <Badge
                variant="outline"
                className="hidden gap-1 text-[11px] text-muted-foreground sm:inline-flex"
              >
                <TagIcon className="size-3" />
                {t('people.matchTag')}
              </Badge> */}
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs -mb-1"
                aria-pressed={said}
                onClick={() => setSaid((wasSaid) => !wasSaid)}
              >
                <Check className="size-3.5" />
                {said ? t('people.markedSaid') : t('people.markSaid')}
              </Button>
            </TalkingPointCard>

            <ul className="mt-1 ml-5 border-l border-border/70 pl-1.5">
              <li>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                  onClick={() => setExpanded((open) => !open)}
                >
                  <ChevronRight
                    className={cn('size-3.5 transition-transform', expanded && 'rotate-90')}
                  />
                  {expanded
                    ? t('people.hideSubEntries')
                    : t('people.hiddenSubEntries', { count: 1 })}
                </Button>
              </li>
              {/* Faded and uncarded once opened, which is how the real screen draws a line that is
                  context rather than something to say. */}
              {expanded && (
                <li className="rounded-xl py-1.5 pr-2 pl-3 opacity-70">
                  <EntryRow entry={subEntry} showChips={false} showDate={false} />
                </li>
              )}
            </ul>
          </li>
        </ul>
      </DemoCard>

      {/* Where step 3 pays off: importance is not a label, it is how long this stays on the list. */}
      <p className="mx-auto w-full max-w-md text-sm text-muted-foreground lg:col-span-3 lg:max-w-3xl">
        {t('onboarding.people.decay')}
      </p>
    </div>
  );
}
