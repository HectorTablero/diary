import type { PersonDto } from '@diary/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePeople } from '@/api/hooks';
import {
  createPluginRecord,
  createPluginRecords,
  deletePluginRecord,
  deletePluginRecords,
  getUndatedRecords,
  updatePluginRecord,
} from '@/db/pluginRecords';
import { onSyncApplied } from '@/db/sync';
import { getPluginSettings, savePluginSettings } from '../enabled';
import {
  groupData,
  linkData,
  ME_ID,
  nextGroupColor,
  pairKey,
  parseGraph,
  PLUGIN_ID,
  type Group,
  type Link,
  type Strength,
} from './model';

export interface SocialGraph {
  loading: boolean;
  people: PersonDto[];
  personById: ReadonlyMap<string, PersonDto>;
  /** A person's name, or the translated "You" for ME_ID. */
  nameOf: (id: string) => string;
  /** Whether "you" are drawn in the graph. Synced, like the plugin's other settings. */
  showMe: boolean;
  setShowMe: (value: boolean) => void;
  /** Includes links and memberships involving "you", whatever `showMe` says — hiding is a
      display choice, and must never make a group edit drop you from it. */
  links: Link[];
  groups: Group[];
  /** Everyone the graph draws — the People list, plus "you" first while `showMe` is on. */
  everyone: { id: string; name: string; aliases: string[]; me?: boolean }[];
  /** `links` minus any involving "you" while hidden. What to draw and list, never what to edit. */
  shownLinks: Link[];
  /** Whether an id is someone currently drawn. */
  visible: (id: string) => boolean;
  linkBetween: (x: string, y: string) => Link | undefined;
  setLink: (x: string, y: string, strength: Strength, note?: string) => Promise<void>;
  setLinkNote: (link: Link, note: string) => Promise<void>;
  removeLink: (link: Link) => Promise<void>;
  /** Links every pair among `ids` that isn't linked yet, at `strength`. */
  connectAll: (ids: readonly string[], strength: Strength) => Promise<void>;
  /** Removes every link among `ids`. Temporary: drop next release. */
  disconnectAll: (ids: readonly string[]) => Promise<void>;
  createGroup: (name: string, members: readonly string[]) => Promise<void>;
  updateGroup: (group: Group, patch: Partial<Omit<Group, 'id'>>) => Promise<void>;
  removeGroup: (group: Group) => Promise<void>;
}

/**
 * The graph, joined to the people list and kept fresh across syncs.
 *
 * People who no longer exist are filtered out here, on read, rather than chased on delete: a person
 * can be deleted while this plugin is off, and the rows it left behind are harmless until shown.
 */
export function useSocialGraph(): SocialGraph {
  const { t } = useTranslation();
  const { data: people, isLoading: peopleLoading } = usePeople();
  const [raw, setRaw] = useState<ReturnType<typeof parseGraph> | null>(null);
  const [showMe, setShowMeState] = useState(true);

  const load = useCallback(async () => {
    const [rows, settings] = await Promise.all([
      getUndatedRecords(PLUGIN_ID),
      getPluginSettings(PLUGIN_ID),
    ]);
    setRaw(parseGraph(rows));
    setShowMeState(settings.showMe !== false);
  }, []);

  const setShowMe = useCallback((value: boolean) => {
    setShowMeState(value);
    void savePluginSettings(PLUGIN_ID, { showMe: value });
  }, []);

  useEffect(() => {
    void load();
    return onSyncApplied(() => void load());
  }, [load]);

  // Collapsed duplicates (see parseGraph) are deleted once seen, so they converge everywhere.
  useEffect(() => {
    if (raw?.duplicateLinkIds.length) void deletePluginRecords(raw.duplicateLinkIds);
  }, [raw]);

  const personById = useMemo(
    () => new Map((people ?? []).map((person) => [person.id, person])),
    [people],
  );

  const nameOf = useCallback(
    (id: string) =>
      id === ME_ID ? t('plugins.social-graph.you') : (personById.get(id)?.name ?? ''),
    [personById, t],
  );

  const { links, groups, byPair } = useMemo(() => {
    const known = (id: string) => id === ME_ID || personById.has(id);
    const links = (raw?.links ?? []).filter((link) => known(link.a) && known(link.b));
    const groups = (raw?.groups ?? []).map((group) => ({
      ...group,
      members: group.members.filter(known),
    }));
    return { links, groups, byPair: new Map(links.map((link) => [pairKey(link.a, link.b), link])) };
  }, [raw, personById]);

  const visible = useCallback(
    (id: string) => (id === ME_ID ? showMe : personById.has(id)),
    [showMe, personById],
  );
  const everyone = useMemo(
    () => [
      ...(showMe
        ? [{ id: ME_ID, name: t('plugins.social-graph.you'), aliases: [], me: true }]
        : []),
      ...(people ?? []).map(({ id, name, aliases }) => ({ id, name, aliases })),
    ],
    [showMe, people, t],
  );
  const shownLinks = useMemo(
    () => (showMe ? links : links.filter((link) => link.a !== ME_ID && link.b !== ME_ID)),
    [showMe, links],
  );

  const linkBetween = useCallback((x: string, y: string) => byPair.get(pairKey(x, y)), [byPair]);

  const setLink = useCallback(
    async (x: string, y: string, strength: Strength, note?: string) => {
      const existing = byPair.get(pairKey(x, y));
      if (existing) {
        await updatePluginRecord(existing.id, linkData(x, y, strength, note ?? existing.note));
      } else {
        await createPluginRecord(PLUGIN_ID, 'record', '', linkData(x, y, strength, note ?? ''));
      }
      await load();
    },
    [byPair, load],
  );

  const setLinkNote = useCallback(
    async (link: Link, note: string) => {
      await updatePluginRecord(link.id, linkData(link.a, link.b, link.strength, note));
      await load();
    },
    [load],
  );

  const removeLink = useCallback(
    async (link: Link) => {
      await deletePluginRecord(link.id);
      await load();
    },
    [load],
  );

  const connectAll = useCallback(
    async (ids: readonly string[], strength: Strength) => {
      const datas: ReturnType<typeof linkData>[] = [];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          if (!byPair.has(pairKey(ids[i], ids[j]))) {
            datas.push(linkData(ids[i], ids[j], strength, ''));
          }
        }
      }
      await createPluginRecords(PLUGIN_ID, 'record', '', datas);
      await load();
    },
    [byPair, load],
  );

  // TEMPORARY: remove one release after it ships.
  const disconnectAll = useCallback(
    async (ids: readonly string[]) => {
      const inside = new Set(ids);
      await deletePluginRecords(
        links.filter((link) => inside.has(link.a) && inside.has(link.b)).map((link) => link.id),
      );
      await load();
    },
    [links, load],
  );

  const createGroup = useCallback(
    async (name: string, members: readonly string[]) => {
      await createPluginRecord(
        PLUGIN_ID,
        'record',
        '',
        groupData(name, nextGroupColor(groups), members),
      );
      await load();
    },
    [groups, load],
  );

  const updateGroup = useCallback(
    async (group: Group, patch: Partial<Omit<Group, 'id'>>) => {
      const next = { ...group, ...patch };
      await updatePluginRecord(group.id, groupData(next.name, next.color, next.members));
      await load();
    },
    [load],
  );

  const removeGroup = useCallback(
    async (group: Group) => {
      await deletePluginRecord(group.id);
      await load();
    },
    [load],
  );

  return {
    loading: raw === null || peopleLoading,
    people: people ?? [],
    personById,
    nameOf,
    showMe,
    setShowMe,
    links,
    groups,
    everyone,
    shownLinks,
    visible,
    linkBetween,
    setLink,
    setLinkNote,
    removeLink,
    connectAll,
    disconnectAll,
    createGroup,
    updateGroup,
    removeGroup,
  };
}
