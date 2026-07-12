import type {
  EntryCreateInput,
  EntryUpdateInput,
  PersonCreateInput,
  PersonUpdateInput,
  SettingsInput,
  TagCreateInput,
  TagUpdateInput,
} from '@diary/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as mutations from '@/db/mutations';
import * as repo from '@/db/repo';
import { hapticTap, hapticWarning } from '@/lib/haptics';

/* All reads and writes go through the local Dexie store (see src/db); the sync
   engine reconciles with the server in the background. Query keys are kept from
   the server-first era so components didn't have to change. */

// --- Tags ---

export const useTags = () =>
  useQuery({
    queryKey: ['tags'],
    queryFn: () => repo.getTags(),
  });

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TagCreateInput) => mutations.createTag(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  });
}

export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TagUpdateInput }) =>
      mutations.updateTag(id, input),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => mutations.deleteTag(id),
    onSuccess: () => qc.invalidateQueries(),
  });
}

// --- People ---

export const usePeople = () =>
  useQuery({
    queryKey: ['people'],
    queryFn: () => repo.getPeople(),
  });

export const usePerson = (id: string) =>
  useQuery({
    queryKey: ['people', id],
    queryFn: () => repo.getPerson(id),
  });

export function useCreatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PersonCreateInput) => mutations.createPerson(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  });
}

export function useUpdatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PersonUpdateInput }) =>
      mutations.updatePerson(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  });
}

export function useDeletePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => mutations.deletePerson(id),
    onSuccess: () => {
      hapticWarning();
      qc.invalidateQueries();
    },
  });
}

export function useMarkCheckup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => mutations.markCheckup(id),
    onSuccess: (data) => {
      hapticTap();
      qc.setQueryData(['people', data.id], data);
      qc.invalidateQueries({ queryKey: ['people'] });
    },
  });
}

export const useTalkingPoints = (personId: string) =>
  useQuery({
    queryKey: ['people', personId, 'talking-points'],
    queryFn: () => repo.getTalkingPoints(personId),
  });

export const useMemories = (personId: string) =>
  useQuery({
    queryKey: ['people', personId, 'memories'],
    queryFn: () => repo.getMemories(personId),
  });

export const usePersonHistory = (personId: string, page: number) =>
  useQuery({
    queryKey: ['people', personId, 'history', page],
    queryFn: () => repo.getHistory(personId, page, 50),
  });

// --- Entries ---

export const useDayEntries = (dateKey: string) =>
  useQuery({
    queryKey: ['entries', 'day', dateKey],
    queryFn: () => repo.getDayEntries(dateKey),
  });

function useInvalidateEntryData() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['entries'] });
    qc.invalidateQueries({ queryKey: ['calendar'] });
    qc.invalidateQueries({ queryKey: ['on-this-day'] });
    qc.invalidateQueries({ queryKey: ['people'] });
    qc.invalidateQueries({ queryKey: ['search'] });
  };
}

export function useCreateEntry() {
  const invalidate = useInvalidateEntryData();
  return useMutation({
    mutationFn: (input: EntryCreateInput) => mutations.createEntry(input),
    onSuccess: () => {
      hapticTap();
      invalidate();
    },
  });
}

export function useUpdateEntry() {
  const invalidate = useInvalidateEntryData();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: EntryUpdateInput }) =>
      mutations.updateEntry(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteEntry() {
  const invalidate = useInvalidateEntryData();
  return useMutation({
    mutationFn: (id: string) => mutations.deleteEntry(id),
    onSuccess: () => {
      hapticWarning();
      invalidate();
    },
  });
}

export function useSetSaid() {
  const invalidate = useInvalidateEntryData();
  return useMutation({
    mutationFn: ({ entryId, personId, said }: { entryId: string; personId: string; said: boolean }) =>
      mutations.setSaid(entryId, personId, said),
    onSuccess: () => {
      hapticTap();
      invalidate();
    },
  });
}

export function useSetHidden() {
  const invalidate = useInvalidateEntryData();
  return useMutation({
    mutationFn: ({
      entryId,
      personId,
      hidden,
    }: {
      entryId: string;
      personId: string;
      hidden: boolean;
    }) => mutations.setHidden(entryId, personId, hidden),
    onSuccess: invalidate,
  });
}

// --- Calendar / search ---

export const useCalendarMonth = (year: number, month: number) =>
  useQuery({
    queryKey: ['calendar', year, month],
    queryFn: () => repo.getCalendarMonth(year, month),
  });

export const useOnThisDay = (dateKey: string) =>
  useQuery({
    queryKey: ['on-this-day', dateKey],
    queryFn: () => repo.getOnThisDay(dateKey),
  });

export const useSearch = (params: URLSearchParams, enabled: boolean) =>
  useQuery({
    queryKey: ['search', params.toString()],
    queryFn: () => repo.search(params),
    enabled,
  });

// --- Settings ---

export const useSettings = () =>
  useQuery({
    queryKey: ['settings'],
    queryFn: () => repo.getSettings(),
  });

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SettingsInput) => mutations.saveSettings(input),
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data);
      qc.invalidateQueries({ queryKey: ['people'] });
    },
  });
}
