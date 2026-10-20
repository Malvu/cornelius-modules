/**
 * Le temps du foyer : jours civils et heures murales dans un fuseau IANA (`context.timeZone`),
 * changements d'heure compris. Partagé par les modules qui disent « ce soir », « demain »,
 * « à minuit », sans dépendance.
 */

export type Wall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export const dayMs = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Heure murale d'un instant dans un fuseau. */
export function wallIn(ms: number, zone: string): Wall {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(zone, formatter);
  }
  const p = Object.fromEntries(formatter.formatToParts(ms).map((part) => [part.type, part.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

const wallUtc = (w: Wall) => Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);

/**
 * Instant UTC d'une heure murale dans un fuseau. Une heure qui existe deux fois (passage à
 * l'heure d'hiver) désigne la première (RFC 5545 § 3.3.5) ; une heure qui n'existe pas
 * (passage à l'heure d'été) glisse après le saut.
 */
export function zonedTime(wall: Wall, zone: string): number {
  const target = wallUtc(wall);
  let guess = target;
  for (let pass = 0; pass < 3; pass += 1) {
    const offset = wallUtc(wallIn(guess, zone)) - guess;
    const next = target - offset;
    if (next === guess) break;
    guess = next;
  }
  const earlier = guess - 3_600_000;
  if (wallUtc(wallIn(earlier, zone)) === target) return earlier;
  if (wallUtc(wallIn(guess, zone)) === target) return guess;
  // Heure inexistante : le décalage d'avant le saut s'applique (2 h 30 devient 3 h 30).
  const before = target - 6 * 3_600_000;
  return target - (wallUtc(wallIn(before, zone)) - before);
}

/** Jour civil d'un instant dans un fuseau, compté en jours depuis le 1er janvier 1970. */
export function dayIn(ms: number, zone: string): number {
  const w = wallIn(ms, zone);
  return Date.UTC(w.year, w.month - 1, w.day) / dayMs;
}

/** Jour civil d'un instant dans un fuseau, au format AAAA-MM-JJ. */
export function dateIn(ms: number, zone: string): string {
  return new Date(dayIn(ms, zone) * dayMs).toISOString().slice(0, 10);
}

/** Premier instant d'un jour civil (compté depuis 1970) dans un fuseau. */
export function startOfDay(day: number, zone: string): number {
  const date = new Date(day * dayMs);
  return zonedTime(
    {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
    },
    zone,
  );
}

/** Prochain instant, strictement après `now`, où il est `hour`:`minute` dans le fuseau. */
export function nextWallTime(now: number, zone: string, hour: number, minute = 0): number {
  const today = dayIn(now, zone);
  for (const day of [today, today + 1, today + 2]) {
    const date = new Date(day * dayMs);
    const candidate = zonedTime(
      {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour,
        minute,
        second: 0,
      },
      zone,
    );
    if (candidate > now) return candidate;
  }
  return now + dayMs;
}

/** Minuit suivant dans le fuseau : le moment où « demain » devient « aujourd'hui ». */
export function nextMidnight(now: number, zone: string): number {
  return nextWallTime(now, zone, 0, 0);
}

/** Instant ISO, pour `refreshAt` et les dates des données. */
export const iso = (ms: number) => new Date(ms).toISOString();
