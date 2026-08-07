import { MutationObserver, onlineManager, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from './queryClient';

/* The app is local-first: queryFns read Dexie and mutationFns write it, so both must run with no
   connection. React Query's default networkMode ('online') assumes the opposite and *pauses* the
   work — mutationFn never runs and mutateAsync never settles, which is why saving offline used to
   do nothing at all, silently and without an error. Asserted here because it is a default rather
   than a line of code: nothing else in the app would notice if the override were dropped. */

afterEach(() => {
  onlineManager.setOnline(true);
});

/** Let the observer's scheduler run; a paused mutation/query never calls its fn at all. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('queryClient offline behaviour', () => {
  it('runs mutations while offline instead of pausing them', async () => {
    onlineManager.setOnline(false);
    const mutationFn = vi.fn().mockResolvedValue('written to dexie');
    const observer = new MutationObserver(queryClient, { mutationFn });

    const result = observer.mutate(undefined);
    await tick();

    expect(mutationFn).toHaveBeenCalledTimes(1);
    await expect(result).resolves.toBe('written to dexie');
  });

  it('runs queries while offline instead of pausing them', async () => {
    onlineManager.setOnline(false);
    const queryFn = vi.fn().mockResolvedValue(['an entry from dexie']);
    const observer = new QueryObserver(queryClient, { queryKey: ['offline-read'], queryFn });

    const unsubscribe = observer.subscribe(() => {});
    await tick();
    unsubscribe();

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(observer.getCurrentResult().fetchStatus).not.toBe('paused');
  });
});
