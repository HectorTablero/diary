import { HEX_COLOR_REGEX } from '@diary/shared';
import { Check, ChevronLeft, Minus, Pencil, Plus, Unlink, Users, Waypoints, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { EntityPicker } from '@/components/entry/EntityPicker';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { notifyError } from '@/lib/notify';
import { matchNamed } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { GraphCanvas } from './GraphCanvas';
import {
  DEFAULT_STRENGTH,
  GROUP_COLORS,
  MAX_GROUP_MEMBERS,
  MAX_GROUP_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  ME_ID,
  type Group,
  type Strength,
} from './model';
import { StrengthBars, StrengthPicker } from './StrengthPicker';
import { useSocialGraph, type SocialGraph } from './useSocialGraph';

/**
 * The social graph's screen, opened from the People list.
 *
 * The graph is the picture and the selection is the verb: tap people to select them, and the panel
 * beside the graph offers whatever makes sense for that many — one person's connections, how close
 * a pair is, or putting several in a group. Everything the graph can do is also reachable from the
 * panel and its person picker, so nothing here needs a pointer.
 */
export default function SocialGraphPage() {
  const { t } = useTranslation();
  const graph = useSocialGraph();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string[]>([]);
  const [onlyConnected, setOnlyConnected] = useState(false);

  // `?focus=<id>` — the profile card's "open in graph" — starts with that person selected.
  const focusId = params.get('focus');
  const [focused, setFocused] = useState<string | null>(null);
  useEffect(() => {
    if (!focusId || focusId === focused || !graph.personById.has(focusId)) return;
    setFocused(focusId);
    setSelected([focusId]);
  }, [focusId, focused, graph.personById]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));

  // Groups as drawn: without "you" while hidden. Edits still go through `graph.groups`.
  const shownGroups = useMemo(
    () => graph.groups.map((group) => ({ ...group, members: group.members.filter(graph.visible) })),
    [graph.groups, graph.visible],
  );

  const shownPeople = useMemo(() => {
    if (!onlyConnected) return graph.everyone;
    const involved = new Set(selected);
    for (const link of graph.shownLinks) involved.add(link.a).add(link.b);
    for (const group of shownGroups) for (const id of group.members) involved.add(id);
    return graph.everyone.filter((person) => involved.has(person.id));
  }, [onlyConnected, graph.everyone, graph.shownLinks, shownGroups, selected]);

  const legend = shownGroups.filter((group) => group.members.length > 0);

  return (
    <PageContainer className="lg:max-w-5xl xl:max-w-6xl">
      <PageHeader
        title={
          <span className="flex items-center gap-1">
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="-ml-2 size-8 text-muted-foreground"
            >
              <Link to="/people" aria-label={t('common.back')}>
                <ChevronLeft className="size-5" />
              </Link>
            </Button>
            {t('plugins.social-graph.title')}
          </span>
        }
      />

      {graph.loading ? (
        <Skeleton className="h-[55svh] w-full rounded-xl" />
      ) : graph.people.length < 2 ? (
        <EmptyState
          icon={Users}
          title={t('plugins.social-graph.needPeople')}
          description={t('plugins.social-graph.needPeopleDescription')}
        >
          <Button asChild size="sm" className="mt-2">
            <Link to="/people">{t('people.title')}</Link>
          </Button>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                {t('plugins.social-graph.showMe')}
                <Switch
                  size="sm"
                  checked={graph.showMe}
                  onCheckedChange={(value) => {
                    graph.setShowMe(value);
                    if (!value) setSelected((prev) => prev.filter((id) => id !== ME_ID));
                  }}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                {t('plugins.social-graph.onlyConnected')}
                <Switch size="sm" checked={onlyConnected} onCheckedChange={setOnlyConnected} />
              </label>
            </div>
            <div className="relative h-[55svh] min-h-80 overflow-hidden rounded-xl border bg-card shadow-xs lg:h-[calc(100svh-13rem)]">
              <GraphCanvas
                people={shownPeople}
                links={graph.shownLinks}
                groups={shownGroups}
                selected={selectedSet}
                onToggle={toggle}
                onSelectPair={(a, b) => setSelected([a, b])}
                onClear={() => setSelected([])}
                ariaLabel={t('plugins.social-graph.graphLabel')}
              />
            </div>
            {legend.length > 0 && (
              <ul
                aria-label={t('plugins.social-graph.groups')}
                className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground"
              >
                {legend.map((group) => (
                  <li key={group.id} className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: group.color }}
                    />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{group.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <aside className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs lg:sticky lg:top-4">
            <SelectionSearch graph={graph} selected={selected} setSelected={setSelected} />
            <SelectionPanel graph={graph} selected={selected} setSelected={setSelected} />
          </aside>
        </div>
      )}
    </PageContainer>
  );
}

function useRun() {
  const { t } = useTranslation();
  return (work: Promise<unknown>) => void work.catch(() => notifyError(t('errors.unknown')));
}

interface Bunch {
  id: string;
  name: string;
  color: string;
  members: string[];
}

/**
 * One search for the three ways to select: a person toggles them, and a group or tag adds everyone
 * in it to the selection (or, once they're all in, takes them back out). Only ever the selection —
 * group membership is changed from the panel's group pills, never from here.
 */
function SelectionSearch({
  graph,
  selected,
  setSelected,
}: {
  graph: SocialGraph;
  selected: string[];
  setSelected: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const tags = useMemo(() => {
    const byId = new Map<string, Bunch>();
    for (const person of graph.people) {
      for (const tag of person.tags) {
        const entry = byId.get(tag.id) ?? { ...tag, members: [] };
        entry.members.push(person.id);
        byId.set(tag.id, entry);
      }
    }
    return [...byId.values()].sort((x, y) => x.name.localeCompare(y.name));
  }, [graph.people]);

  const q = query.trim();
  const chosen = new Set(selected);
  const sets = (kind: string, items: Bunch[]) =>
    matchNamed(items, q)
      .map(({ match }) => {
        const members = match.members.filter(graph.visible);
        return {
          ...match,
          key: `${kind}:${match.id}`,
          members,
          all: members.every((id) => chosen.has(id)),
        };
      })
      .filter((set) => set.members.length > 0);
  const results = q
    ? [
        { heading: t('plugins.social-graph.groups'), items: sets('group', graph.groups) },
        { heading: t('nav.tags'), items: sets('tag', tags) },
      ]
    : [];
  const people = q ? matchNamed(graph.everyone, q) : [];

  const pickSet = (members: string[], all: boolean) => {
    const out = new Set(members);
    setSelected(
      all ? selected.filter((id) => !out.has(id)) : [...new Set([...selected, ...members])],
    );
    setQuery('');
  };
  const pickPerson = (id: string) => {
    setSelected(chosen.has(id) ? selected.filter((v) => v !== id) : [...selected, id]);
    setQuery('');
  };

  return (
    <Command
      shouldFilter={false}
      // CommandInput already draws its own field; drop the frame and padding around it.
      className="h-auto overflow-visible bg-transparent p-0 text-foreground **:data-[slot=command-input-wrapper]:p-0"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        onKeyDown={(event) => event.key === 'Escape' && setQuery('')}
        placeholder={t('plugins.social-graph.searchSelect')}
      />
      {q && (
        <CommandList className="mt-1 max-h-64 rounded-lg border">
          {results.map(
            ({ heading, items }) =>
              items.length > 0 && (
                <CommandGroup key={heading} heading={heading}>
                  {items.map((set) => (
                    <CommandItem
                      key={set.key}
                      value={set.key}
                      onSelect={() => pickSet(set.members, set.all)}
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: set.color }}
                      />
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{set.name}</span>
                      {set.all ? (
                        <Check className="size-3" aria-hidden />
                      ) : (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {set.members.length}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ),
          )}
          {people.length > 0 && (
            <CommandGroup heading={t('nav.people')}>
              {people.map(({ match: person, alias }) => (
                <CommandItem
                  key={person.id}
                  value={`person:${person.id}`}
                  onSelect={() => pickPerson(person.id)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {alias ? `${person.name} (${alias})` : person.name}
                  </span>
                  {chosen.has(person.id) && <Check className="size-3" aria-hidden />}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {people.length === 0 && results.every(({ items }) => items.length === 0) && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('common.noResults')}
            </p>
          )}
        </CommandList>
      )}
    </Command>
  );
}

function SelectionPanel({
  graph,
  selected,
  setSelected,
}: {
  graph: SocialGraph;
  selected: string[];
  setSelected: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Group | null>(null);
  const people = selected
    .filter(graph.visible)
    .map((id) => ({ id, name: graph.nameOf(id), me: id === ME_ID }));

  if (people.length === 0) {
    return (
      <>
        <p className="text-sm text-muted-foreground">{t('plugins.social-graph.hint')}</p>
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t('plugins.social-graph.groups')}</h2>
          {graph.groups.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('plugins.social-graph.noGroups')}</p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {graph.groups.map((group) => (
                <li key={group.id} className="flex items-center gap-1">
                  {/* Not a button: selecting a whole group lives in the search above, where it
                      reads as selecting rather than as toggling membership. */}
                  <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-sm">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: group.color }}
                    />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{group.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {group.members.length}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground"
                    aria-label={t('plugins.social-graph.editGroup', { name: group.name })}
                    onClick={() => setEditing(group)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {editing && <GroupDialog graph={graph} group={editing} onClose={() => setEditing(null)} />}
      </>
    );
  }

  const ids = people.map((person) => person.id);
  return (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">
            {people.length === 1 && people[0].me ? (
              people[0].name
            ) : people.length === 1 ? (
              <Link to={`/people/${people[0].id}`} className="hover:underline">
                {people[0].name}
              </Link>
            ) : people.length === 2 ? (
              t('plugins.social-graph.pairTitle', { a: people[0].name, b: people[1].name })
            ) : (
              t('plugins.social-graph.selectedCount', { count: people.length })
            )}
          </h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="-mt-1 -mr-2 size-7 shrink-0 text-muted-foreground"
          aria-label={t('common.clear')}
          onClick={() => setSelected([])}
        >
          <X className="size-4" />
        </Button>
      </div>
      {people.length > 2 && (
        <ul className="-mt-2 flex max-h-40 flex-wrap gap-1 overflow-y-auto">
          {people.map((person) => (
            <li
              key={person.id}
              className="flex min-h-6 max-w-full items-center gap-0.5 rounded-xl bg-muted py-0.5 pr-0.5 pl-2 text-xs"
            >
              <span className="min-w-0 [overflow-wrap:anywhere]">{person.name}</span>
              <button
                type="button"
                aria-label={t('plugins.social-graph.deselect', { name: person.name })}
                onClick={() => setSelected(selected.filter((id) => id !== person.id))}
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {people.length === 1 && (
        <Connections graph={graph} personId={ids[0]} setSelected={setSelected} />
      )}
      {people.length === 2 && <PairEditor key={ids.join()} graph={graph} a={ids[0]} b={ids[1]} />}
      {people.length > 2 && <ConnectAll graph={graph} ids={ids} />}
      <GroupToggles graph={graph} ids={ids} />
    </>
  );
}

function Connections({
  graph,
  personId,
  setSelected,
}: {
  graph: SocialGraph;
  personId: string;
  setSelected: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const connections = graph.shownLinks
    .filter((link) => link.a === personId || link.b === personId)
    .map((link) => {
      const id = link.a === personId ? link.b : link.a;
      return { link, other: { id, name: graph.nameOf(id) } };
    })
    .sort((x, y) => y.link.strength - x.link.strength || x.other.name.localeCompare(y.other.name));
  const linked = new Set(connections.map(({ other }) => other.id));
  const candidates = graph.everyone.filter(
    (person) => person.id !== personId && !linked.has(person.id),
  );

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">
        {t('plugins.social-graph.connections', { count: connections.length })}
      </h3>
      {connections.length > 0 && (
        <ul className="-mx-2 flex flex-col">
          {connections.map(({ link, other }) => (
            <li key={link.id}>
              <button
                type="button"
                onClick={() => setSelected([personId, other.id])}
                className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{other.name}</span>
                  {link.note && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {link.note}
                    </span>
                  )}
                </span>
                <StrengthBars value={link.strength} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {candidates.length > 0 && (
        <EntityPicker
          trigger={
            <Button variant="outline" size="sm" className="w-fit gap-1.5">
              <Plus className="size-3.5" />
              {t('plugins.social-graph.connectTo')}
            </Button>
          }
          items={candidates.map((person) => ({
            id: person.id,
            label: person.name,
            aliases: person.aliases,
          }))}
          selectedIds={[]}
          // Picking someone opens the pair, which asks how close they are — nothing is saved until
          // that's answered, so a mis-tap here costs nothing.
          onToggle={(id) => setSelected([personId, id])}
          placeholder={t('common.search')}
        />
      )}
    </section>
  );
}

function PairEditor({ graph, a, b }: { graph: SocialGraph; a: string; b: string }) {
  const { t } = useTranslation();
  const run = useRun();
  const link = graph.linkBetween(a, b);
  const [note, setNote] = useState(link?.note ?? '');
  const [confirming, setConfirming] = useState(false);

  // A sync can change the note under us; follow it unless the field holds unsaved typing.
  const savedNote = link?.note ?? '';
  const [lastSaved, setLastSaved] = useState(savedNote);
  if (savedNote !== lastSaved) {
    if (note === lastSaved) setNote(savedNote);
    setLastSaved(savedNote);
  }

  const saveNote = () => {
    if (link && note !== link.note) run(graph.setLinkNote(link, note));
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">
          {t('plugins.social-graph.howClose')}
        </h3>
        <StrengthPicker
          value={link?.strength ?? null}
          onChange={(strength) => run(graph.setLink(a, b, strength))}
        />
      </div>
      {link && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="social-graph-note" className="text-xs text-muted-foreground">
              {t('plugins.social-graph.note')}{' '}
              <span className="font-normal">({t('common.optional')})</span>
            </Label>
            <Textarea
              id="social-graph-note"
              value={note}
              maxLength={MAX_NOTE_LENGTH}
              onChange={(event) => setNote(event.target.value)}
              onBlur={saveNote}
              placeholder={t('plugins.social-graph.notePlaceholder')}
              className="min-h-16 text-sm"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-fit gap-1.5 text-muted-foreground hover:text-destructive"
            onClick={() => setConfirming(true)}
          >
            <Unlink className="size-3.5" />
            {t('plugins.social-graph.disconnect')}
          </Button>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={t('plugins.social-graph.disconnectTitle')}
            description={t('plugins.social-graph.disconnectDescription')}
            confirmLabel={t('plugins.social-graph.disconnect')}
            destructive
            onConfirm={() => {
              setConfirming(false);
              run(graph.removeLink(link));
            }}
          />
        </>
      )}
    </section>
  );
}

function ConnectAll({ graph, ids }: { graph: SocialGraph; ids: string[] }) {
  const { t } = useTranslation();
  const run = useRun();
  const [strength, setStrength] = useState<Strength>(DEFAULT_STRENGTH);
  const [busy, setBusy] = useState(false);
  let missing = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) if (!graph.linkBetween(ids[i], ids[j])) missing++;
  }
  if (missing === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Waypoints className="size-3.5" />
        {t('plugins.social-graph.allConnected')}
      </p>
    );
  }
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">
        {t('plugins.social-graph.connectAllStrength')}
      </h3>
      <StrengthPicker value={strength} onChange={setStrength} />
      <Button
        variant="outline"
        size="sm"
        className="mt-1 w-fit gap-1.5"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          run(graph.connectAll(ids, strength).finally(() => setBusy(false)));
        }}
      >
        <Waypoints className="size-3.5" />
        {t('plugins.social-graph.connectAll', { count: missing })}
      </Button>
    </section>
  );
}

function GroupToggles({ graph, ids }: { graph: SocialGraph; ids: string[] }) {
  const { t } = useTranslation();
  const run = useRun();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const create = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    run(graph.createGroup(name, ids));
    setName('');
    setNaming(false);
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">
        {t('plugins.social-graph.groups')}
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {graph.groups.map((group) => {
          const inside = ids.filter((id) => group.members.includes(id)).length;
          const all = inside === ids.length;
          const some = inside > 0 && !all;
          return (
            <button
              key={group.id}
              type="button"
              aria-pressed={some ? 'mixed' : all}
              onClick={() => {
                if (all) {
                  const out = new Set(ids);
                  run(
                    graph.updateGroup(group, { members: group.members.filter((m) => !out.has(m)) }),
                  );
                  return;
                }
                const members = [...new Set([...group.members, ...ids])];
                if (members.length > MAX_GROUP_MEMBERS) {
                  notifyError(t('plugins.social-graph.groupFull', { count: MAX_GROUP_MEMBERS }));
                  return;
                }
                run(graph.updateGroup(group, { members }));
              }}
              className={cn(
                'flex min-h-7 max-w-full items-center gap-1.5 rounded-2xl border px-2.5 py-1 text-left text-xs transition-colors',
                all
                  ? 'border-transparent bg-accent font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: group.color }}
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">{group.name}</span>
              {all && <Check className="size-3 shrink-0" aria-hidden />}
              {some && <Minus className="size-3 shrink-0" aria-hidden />}
            </button>
          );
        })}
        {naming ? (
          <form onSubmit={create} className="flex items-center gap-1">
            <Input
              autoFocus
              value={name}
              maxLength={MAX_GROUP_NAME_LENGTH}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Escape' && setNaming(false)}
              placeholder={t('plugins.social-graph.groupNamePlaceholder')}
              aria-label={t('plugins.social-graph.groupName')}
              className="h-7 w-36 text-xs"
            />
            <Button type="submit" size="sm" className="h-7" disabled={!name.trim()}>
              {t('common.create')}
            </Button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="flex h-7 items-center gap-1 rounded-full border border-dashed px-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3" />
            {t('plugins.social-graph.newGroup')}
          </button>
        )}
      </div>
    </section>
  );
}

/** The temporary "disconnect everyone in this group" button, hidden; the code behind it stays.
    TEMPORARY: remove with graph.disconnectAll and its strings one release after it ships. */
const SHOW_DISCONNECT_GROUP = false as boolean;

function GroupDialog({
  graph,
  group,
  onClose,
}: {
  graph: SocialGraph;
  group: Group;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const run = useRun();
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState(group.color);
  const [confirming, setConfirming] = useState(false);
  // TEMPORARY: remove one release after it ships, with graph.disconnectAll and its strings.
  const [unlinking, setUnlinking] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('plugins.social-graph.editGroupTitle')}</DialogTitle>
        </DialogHeader>
        <form
          id="social-graph-group"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim() || !HEX_COLOR_REGEX.test(color)) return;
            run(graph.updateGroup(group, { name, color }));
            onClose();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="social-graph-group-name">{t('plugins.social-graph.groupName')}</Label>
            <Input
              id="social-graph-group-name"
              value={name}
              maxLength={MAX_GROUP_NAME_LENGTH}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span id="social-graph-color" className="text-sm font-medium">
              {t('plugins.social-graph.groupColor')}
            </span>
            <div
              role="radiogroup"
              aria-labelledby="social-graph-color"
              className="flex flex-wrap gap-2"
            >
              {GROUP_COLORS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  role="radio"
                  aria-checked={swatch.toLowerCase() === color.toLowerCase()}
                  aria-label={swatch}
                  onClick={() => setColor(swatch)}
                  className="size-7 rounded-full ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:ring-2 aria-checked:ring-foreground"
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </div>
            {/* Any colour, the way tags take one: the native picker plus its hex. */}
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={HEX_COLOR_REGEX.test(color) ? color : '#000000'}
                onChange={(event) => setColor(event.target.value)}
                aria-label={t('plugins.social-graph.groupColor')}
                className="size-9 cursor-pointer rounded-md border bg-transparent p-1"
              />
              <Input
                value={color}
                onChange={(event) => {
                  if (/^#[0-9A-Fa-f]{0,6}$/.test(event.target.value)) setColor(event.target.value);
                }}
                aria-label={t('plugins.social-graph.groupColor')}
                className="w-28 font-mono text-sm"
              />
            </div>
          </div>
          {SHOW_DISCONNECT_GROUP && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit gap-1.5 text-muted-foreground hover:text-destructive"
              onClick={() => setUnlinking(true)}
            >
              <Unlink className="size-3.5" />
              {t('plugins.social-graph.disconnectGroup')}
            </Button>
          )}
        </form>
        <ConfirmDialog
          open={unlinking}
          onOpenChange={setUnlinking}
          title={t('plugins.social-graph.disconnectGroupTitle', { name: group.name })}
          description={t('plugins.social-graph.disconnectGroupDescription')}
          confirmLabel={t('plugins.social-graph.disconnect')}
          destructive
          onConfirm={() => {
            setUnlinking(false);
            run(graph.disconnectAll(group.members));
          }}
        />
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirming(true)}
          >
            {t('plugins.social-graph.deleteGroup')}
          </Button>
          <Button
            type="submit"
            form="social-graph-group"
            disabled={!name.trim() || !HEX_COLOR_REGEX.test(color)}
          >
            {t('common.save')}
          </Button>
        </DialogFooter>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('plugins.social-graph.deleteGroupTitle', { name: group.name })}
          description={t('plugins.social-graph.deleteGroupDescription')}
          confirmLabel={t('common.delete')}
          destructive
          onConfirm={() => {
            run(graph.removeGroup(group));
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
