import { useEffect, useState } from "react";

/**
 * Counts down to an absolute target time (ms epoch). Returns whole seconds
 * remaining, ticking every 500ms. Pass null to disable.
 */
export function useCountdownTo(targetMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (targetMs === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [targetMs]);

  if (targetMs === null) return 0;
  return Math.max(0, Math.ceil((targetMs - now) / 1000));
}

/** "X minutes and Y seconds" phrasing for block countdowns. */
export function formatMinutesSeconds(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes} minute${minutes === 1 ? "" : "s"} and ${seconds} second${
    seconds === 1 ? "" : "s"
  }`;
}
