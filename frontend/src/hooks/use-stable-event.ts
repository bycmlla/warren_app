import { useCallback, useLayoutEffect, useRef } from 'react';

/** Mantém a identidade do callback sem deixar o player preso a um estado antigo da tela. */
export function useStableEvent<Args extends unknown[], Result>(callback: (...args: Args) => Result, scope?: string) {
  const latest = useRef({ callback, scope });
  useLayoutEffect(() => { latest.current = { callback, scope }; }, [callback, scope]);
  return useCallback((...args: Args) => {
    if (latest.current.scope === scope) return latest.current.callback(...args);
  }, [scope]);
}
