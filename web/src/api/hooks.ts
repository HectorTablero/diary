import type {
  CalendarDay,
  EntryCreateInput,
  EntryDto,
  EntryNode,
  EntryUpdateInput,
  PersonCreateInput,
  PersonDto,
  PersonListItem,
  PersonUpdateInput,
  SearchResponse,
  SettingsDto,
  SettingsInput,
  TagCreateInput,
  TagDto,
  TagUpdateInput,
  TagWithStats,
  TalkingPointsResponse,
} from '@diary/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/apiClient';

// --- Tags ---

export const useTags = () =>
  useQuery({
    queryKey: ['tags'],
    queryFn: () => apiGet<{ tags: TagWithStats[] }>('/tags').then((r) => r.tags),
    staleTime: 5 * 60_000,
  });

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TagCreateInput) => apiPost<TagDto>('/tags', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  });
}

export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TagUpdateInput }) =>
      apiPatch<TagDto>(`/tags/${id}`, input),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete<{ ok: boolean }>(`/tags/${id}`),
    onSuccess: () => qc.invalidateQueries(),
  });
}

// --- People ---

export const usePeople = () =>
  useQuery({
    queryKey: ['people'],
    queryFn: () => apiGet<{ people: PersonListItem[] }>('/people').then((r) => r.people),
    staleTime: 5 * 60_000,
  });

export const usePerson = (id: string) =>
  useQuery({
    queryKey: ['people', id],
    queryFn: () => apiGet<PersonDto>(`/people/${id}`),
  });

export function useCreatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PersonCreateInput) => apiPost<PersonDto>('/people', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  });
}

export function useUpdatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PersonUpdateInput }) =>
      apiPatch<PersonDto>(`/people/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  });
}

export function useDeletePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete<{ ok: boolean }>(`/people/${id}`),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useMarkCheckup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPut<PersonDto>(`/people/${id}/checkup`),
    onSuccess: (data) => {
      qc.setQueryData(['people', data.id], data);
      qc.invalidateQueries({ queryKey: ['people'] });
    },
  });
}

export const useTalkingPoints = (personId: string) =>
  useQuery({
    queryKey: ['people', personId, 'talking-points'],
    queryFn: () => apiGet<TalkingPointsResponse>(`/people/${personId}/talking-points`),
  });

export const useMemories = (personId: string) =>
  useQuery({
    queryKey: ['people', personId, 'memories'],
    queryFn: () =>
      apiGet<{ memories: EntryDto[] }>(`/people/${personId}/memories`).then((r) => r.memories),
  });

export const usePersonHistory = (personId: string, page: number) =>
  useQuery({
    queryKey: ['people', personId, 'history', page],
    queryFn: () =>
      apiGet<{ results: EntryDto[]; total: number; page: number; limit: number }>(
        `/people/${personId}/history?page=${page}&limit=50`,
      ),
  });

// --- Entries ---

export const useDayEntries = (dateKey: string) =>
  useQuery({
    queryKey: ['entries', 'day', dateKey],
    queryFn: () => apiGet<{ entries: EntryNode[] }>(`/entries?date=${dateKey}`).then((r) => r.entries),
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
    mutationFn: (input: EntryCreateInput) => apiPost<EntryDto>('/entries', input),
    onSuccess: invalidate,
  });
}

export function useUpdateEntry() {
  const invalidate = useInvalidateEntryData();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: EntryUpdateInput }) =>
      apiPatch<EntryDto>(`/entries/${id}`, input),
    onSuccess: invalidate,
  });
}

export function useDeleteEntry() {
  const invalidate = useInvalidateEntryData();
  return useMutation({
    mutationFn: (id: string) => apiDelete<{ deleted: number }>(`/entries/${id}`),
    onSuccess: invalidate,
  });
}

export function useSetSaid() {
  const invalidate = useInvalidateEntryData();
  return useMutation({
    mutationFn: ({ entryId, personId, said }: { entryId: string; personId: string; said: boolean }) =>
      said
        ? apiPut<{ ok: boolean }>(`/entries/${entryId}/said/${personId}`)
        : apiDelete<{ ok: boolean }>(`/entries/${entryId}/said/${personId}`),
    onSuccess: invalidate,
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
    }) =>
      hidden
        ? apiPut<{ ok: boolean }>(`/entries/${entryId}/hidden/${personId}`)
        : apiDelete<{ ok: boolean }>(`/entries/${entryId}/hidden/${personId}`),
    onSuccess: invalidate,
  });
}

// --- Calendar / search ---

export const useCalendarMonth = (year: number, month: number) =>
  useQuery({
    queryKey: ['calendar', year, month],
    queryFn: () =>
      apiGet<{ days: CalendarDay[] }>(`/calendar?year=${year}&month=${month}`).then((r) => r.days),
  });

export const useOnThisDay = (dateKey: string) =>
  useQuery({
    queryKey: ['on-this-day', dateKey],
    queryFn: () =>
      apiGet<{ entries: EntryDto[] }>(`/on-this-day?date=${dateKey}`).then((r) => r.entries),
  });

export const useSearch = (params: URLSearchParams, enabled: boolean) =>
  useQuery({
    queryKey: ['search', params.toString()],
    queryFn: () => apiGet<SearchResponse>(`/search?${params.toString()}`),
    enabled,
  });

// --- Settings ---

export const useSettings = () =>
  useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<SettingsDto>('/settings'),
    staleTime: 5 * 60_000,
  });

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SettingsInput) => apiPut<SettingsDto>('/settings', input),
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data);
      qc.invalidateQueries({ queryKey: ['people'] });
    },
  });
}
