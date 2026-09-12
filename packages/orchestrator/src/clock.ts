export interface Clock {
  now(): Date;
  nowIso(): string;
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowIso: () => new Date().toISOString(),
};

export function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso), nowIso: () => iso };
}

/** Test helper: advances by `stepMs` on every call, so ordered writes get ordered timestamps. */
export function steppingClock(startIso: string, stepMs = 1000): Clock {
  let time = new Date(startIso).getTime();
  const advance = (): Date => {
    time += stepMs;
    return new Date(time);
  };
  return { now: advance, nowIso: () => advance().toISOString() };
}
