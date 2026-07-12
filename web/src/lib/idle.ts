// Safari has no requestIdleCallback; fall back to a short timeout so
// preload work still yields to anything more urgent.
export function onIdle(callback: () => void): number {
  if (typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(callback, { timeout: 2000 });
  }
  return window.setTimeout(callback, 200) as unknown as number;
}

export function cancelIdle(handle: number): void {
  if (typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(handle);
    return;
  }
  window.clearTimeout(handle);
}
