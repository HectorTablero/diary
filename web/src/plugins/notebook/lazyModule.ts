import { useEffect, useState } from 'react';

/**
 * A module fetched the first time something asks for it, as a hook.
 *
 * For the notebook's heavy renderers — KaTeX (renderMath.ts) and Mermaid (renderDiagram.ts) — which
 * must cost nothing until a document actually contains what they draw. The `load` thunk is where the
 * `import()` lives, and it has to be a literal path there (registry rule 2) so the bundler can give
 * the module a chunk of its own; vite.config.ts then keeps that chunk, and everything only it
 * reaches, out of the service worker's precache.
 *
 * Every caller shares one request. A failed fetch is forgotten rather than kept, so the next caller
 * to mount — once the connection is back — asks again instead of inheriting the failure; until then
 * the hook returns `null`, and whatever the caller shows while loading is also its offline fallback.
 */
export function lazyModule<T>(load: () => Promise<T>) {
  let loaded: T | null = null;
  let pending: Promise<T> | null = null;

  const get = (): Promise<T> =>
    (pending ??= load().then(
      (module) => (loaded = module),
      (error: unknown) => {
        pending = null;
        throw error;
      },
    ));

  /** The module once it is here, `null` until then — and asked for only while `wanted`, so a caller
      that may or may not need it can hold the hook unconditionally and pay nothing when it doesn't. */
  return function useLazyModule(wanted = true): T | null {
    const [module, setModule] = useState(loaded);
    useEffect(() => {
      if (module || !wanted) return;
      let live = true;
      get().then(
        (next) => {
          if (live) setModule(next);
        },
        () => {},
      );
      return () => {
        live = false;
      };
    }, [module, wanted]);
    return module;
  };
}
