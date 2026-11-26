import { useEffect, useReducer } from 'react';

export function useCountdown(deadline: number, now: () => number): number {
  const [, refresh] = useReducer((tick: number) => tick + 1, 0);
  const seconds = Math.max(0, Math.ceil((deadline - now()) / 1000));
  const active = seconds > 0;

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [active, deadline]);

  return seconds;
}
