/** Vacances scolaires et jours fériés : open data de l'Éducation nationale et calendrier.api.gouv.fr. */
import {
  AddonCollectError,
  type AddonCollectContext,
  type AddonDefinition,
  type ModuleSnapshot,
} from '#cornelius/addons';
import { compile } from '#cornelius/validation';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type VacancesConfig = { zone: 'A' | 'B' | 'C' | 'Corse'; region: 'metropole' | 'alsace-moselle' };
type Vacation = { name: string; start: string; end: string };
type PublicHoliday = { date: string; name: string };
type VacancesData = {
  zone: VacancesConfig['zone'];
  region: VacancesConfig['region'];
  vacations: Vacation[];
  publicHolidays: PublicHoliday[];
};

type CalendarPayload = {
  results: {
    description: string;
    population: string | null;
    start_date: string;
    end_date: string;
  }[];
};

const calendarUrl =
  'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records';
const holidaysUrl = 'https://calendrier.api.gouv.fr/jours-feries';
const maxPeriods = 6;

const validateCalendar = compile<CalendarPayload>({
  type: 'object',
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        required: ['description', 'start_date', 'end_date'],
        properties: {
          description: { type: 'string' },
          population: { type: ['string', 'null'] },
          start_date: { type: 'string' },
          end_date: { type: 'string' },
        },
      },
    },
  },
});
const validateHolidays = compile<Record<string, string>>({
  type: 'object',
  propertyNames: { pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  additionalProperties: { type: 'string', minLength: 1 },
});

// --- Dates : jours civils de Paris, au format AAAA-MM-JJ -------------------------------------

const parisDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const longDay = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const shortDay = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});
const dayMs = 86_400_000;

/** Jour de Paris d'un instant : « 2026-10-16T22:00:00+00:00 » donne le 17 octobre. */
function dayOf(instant: number): string {
  return parisDay.format(instant);
}

function dayNumber(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year!, month! - 1, date!) / dayMs;
}

function shift(day: string, days: number): string {
  return new Date((dayNumber(day) + days) * dayMs).toISOString().slice(0, 10);
}

/** « samedi 1er novembre » : le premier du mois se dit « 1er ». */
function spoken(day: string): string {
  return longDay.format(new Date(dayNumber(day) * dayMs)).replace(/ 1 /u, ' 1er ');
}

function brief(day: string): string {
  return shortDay.format(new Date(dayNumber(day) * dayMs)).replace(/^1 /u, '1er ');
}

function inDays(from: string, to: string): string {
  const days = dayNumber(to) - dayNumber(from);
  if (days === 0) return 'aujourd’hui';
  if (days === 1) return 'demain';
  return `dans ${days} jours`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

// --- Noms des périodes ------------------------------------------------------------------------

/** « Vacances d'Hiver » devient « Vacances d'hiver » ; Toussaint, Noël et Pâques gardent leur majuscule. */
function vacationName(description: string): string {
  return description
    .trim()
    .replace(
      /(d'|d’|de )(Hiver|Printemps|Été|Février|Mai|Novembre|Septembre|Carnaval)/gu,
      (_, prefix: string, word: string) => prefix + word.toLowerCase(),
    )
    .slice(0, 80);
}

/** Nom court d'une ligne de carte : « Vacances de Noël » devient « Noël ». */
function shortName(name: string): string {
  return capitalize(name.replace(/^Vacances (de la |de l'|de l’|de |d'|d’)/u, ''));
}

const zoneLabel = (zone: VacancesConfig['zone']) => (zone === 'Corse' ? 'Corse' : `zone ${zone}`);

// --- Collecte ---------------------------------------------------------------------------------

async function fetchJson(
  context: AddonCollectContext<VacancesConfig>,
  url: string,
  provider: string,
): Promise<unknown> {
  const response = await context.http.fetch({
    url,
    method: 'GET',
    signal: context.signal,
    timeoutMs: 8000,
    maxBytes: 64 * 1024,
  });
  if (response.status === 404)
    throw new AddonCollectError('not_found', `${provider} : calendrier introuvable.`);
  if (response.status === 429)
    throw new AddonCollectError(
      'quota',
      `${provider} : trop de demandes, réessayer plus tard.`,
      true,
    );
  if (response.status >= 500)
    throw new AddonCollectError('unavailable', `${provider} indisponible.`, true);
  if (response.status !== 200)
    throw new AddonCollectError(
      'upstream',
      `${provider} : réponse HTTP ${response.status} inattendue.`,
    );
  try {
    return response.json();
  } catch {
    throw new AddonCollectError('malformed', `${provider} : réponse illisible.`);
  }
}

/**
 * Seules les périodes « Vacances … » des élèves sont gardées : les ponts n'ont pas la même
 * convention de dates d'une académie à l'autre, et les lignes « Enseignants » ou « Début
 * des vacances » ne disent pas quand les enfants sont à la maison. `end` est le jour de la
 * rentrée ; `group_by` fusionne côté serveur les académies d'une même zone.
 */
function vacationsFrom(payload: CalendarPayload, today: string): Vacation[] {
  const seen = new Set<string>();
  const vacations: Vacation[] = [];
  for (const row of payload.results) {
    if (!row.description.trim().startsWith('Vacances')) continue;
    if (row.population !== null && row.population !== '-' && row.population !== 'Élèves') continue;
    const startAt = Date.parse(row.start_date);
    const endAt = Date.parse(row.end_date);
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt))
      throw new AddonCollectError('malformed', 'Calendrier scolaire : date illisible.');
    const vacation = {
      name: vacationName(row.description),
      start: dayOf(startAt),
      end: dayOf(endAt),
    };
    if (vacation.end <= vacation.start || vacation.end <= today) continue;
    const key = `${vacation.start}/${vacation.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    vacations.push(vacation);
  }
  return vacations.sort((a, b) => (a.start < b.start ? -1 : 1)).slice(0, maxPeriods);
}

function holidaysFrom(payload: Record<string, string>, today: string): PublicHoliday[] {
  return Object.entries(payload)
    .filter(([date]) => date >= today)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(0, maxPeriods)
    .map(([date, name]) => ({ date, name: name.trim().slice(0, 80) }));
}

// --- Présentation -----------------------------------------------------------------------------

/** Lecture du jour : les dates sont recalculées à chaque présentation, pas à la collecte. */
function situation(data: VacancesData, now: number) {
  const today = dayOf(now);
  const upcoming = data.vacations.filter((vacation) => vacation.end > today);
  const current = upcoming.find((vacation) => vacation.start <= today) ?? null;
  const next = upcoming.find((vacation) => vacation.start > today) ?? null;
  const later = upcoming.filter((vacation) => vacation !== current && vacation !== next);
  const holiday = data.publicHolidays.find((item) => item.date >= today) ?? null;
  return { today, current, next, later, holiday };
}

function holidayText(holiday: PublicHoliday, today: string): string {
  return `${holiday.name}, ${spoken(holiday.date)} (${inDays(today, holiday.date)})`;
}

const addon: AddonDefinition<VacancesConfig, VacancesData> = {
  id: 'vacances',
  apiVersion: 1,
  version: '1.0.0',
  sourceLabel: 'Vacances scolaires et jours fériés',
  configVersion: 1,
  configSchema,
  configDefaults: { zone: 'C', region: 'metropole' },
  dataVersion: 1,
  dataSchema,
  // Le maximum que le cœur accepte : le calendrier change rarement, et la situation du
  // jour (en vacances, dans combien de jours) est recalculée à chaque présentation.
  freshMs: 60 * 60 * 1000,
  tools: [
    {
      name: 'read',
      description:
        'Lire les prochaines vacances scolaires et le prochain jour férié de la zone configurée, ' +
        'et afficher leur carte. Utiliser pour « c’est quand les prochaines vacances ? », ' +
        '« on est en vacances ? », « la rentrée c’est quand ? » ou « le prochain jour férié ? ».',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
    },
  ],
  async collect(context) {
    const { zone, region } = context.config;
    const today = dayOf(context.now());
    const zoneName = zone === 'Corse' ? 'Corse' : `Zone ${zone}`;
    const query = new URLSearchParams({
      select: 'description,population,start_date,end_date',
      where: `zones="${zoneName}" and end_date>="${today}"`,
      group_by: 'description,population,start_date,end_date',
      order_by: 'start_date',
      limit: '100',
    });
    const [calendar, holidays] = await Promise.all([
      fetchJson(context, `${calendarUrl}?${query}`, 'Calendrier scolaire'),
      fetchJson(context, `${holidaysUrl}/${encodeURIComponent(region)}.json`, 'Jours fériés'),
    ]);
    if (!validateCalendar(calendar))
      throw new AddonCollectError('malformed', 'Calendrier scolaire : réponse inattendue.');
    if (!validateHolidays(holidays))
      throw new AddonCollectError('malformed', 'Jours fériés : réponse inattendue.');
    const data: VacancesData = {
      zone,
      region,
      vacations: vacationsFrom(calendar, today),
      publicHolidays: holidaysFrom(holidays, today),
    };
    return {
      data,
      // Rien de publié à venir : la source répond, sans rien à dire.
      empty: data.vacations.length === 0 && data.publicHolidays.length === 0,
      source: { provider: 'education.gouv.fr', sourceId: `${zoneName} · ${region}` },
    };
  },
  ambient: {
    present(snapshot, context) {
      const data = snapshot.data;
      if (!data) throw new Error('Aucun calendrier à afficher.');
      const { today, current, next, holiday } = situation(data, context.now());
      return {
        layout: 'metric',
        // Un calendrier ne vieillit pas d'un relevé à l'autre : la date de collecte n'aide pas.
        showCollectedAt: false,
        title: 'Vacances',
        value: current ? 'En vacances' : next ? capitalize(inDays(today, next.start)) : null,
        subtitle: current
          ? `Rentrée ${spoken(current.end)}`
          : next
            ? next.name
            : 'Aucune période publiée',
        items: holiday
          ? [{ label: 'Férié', value: `${holiday.name}, ${brief(holiday.date)}` }]
          : [],
      };
    },
  },
  present(snapshot: ModuleSnapshot<VacancesData>, context) {
    const data = snapshot.data;
    if (!data) throw new Error('Aucun calendrier à présenter.');
    const stale = snapshot.status === 'stale';
    const { today, current, next, later, holiday } = situation(data, context.now());
    const zone = zoneLabel(data.zone);
    const items: { label: string; value: string }[] = [];
    for (const vacation of (current && next ? [next, ...later] : later).slice(0, 3))
      items.push({
        label: shortName(vacation.name),
        value: `${brief(vacation.start)} → ${brief(shift(vacation.end, -1))}`,
      });
    if (holiday) items.push({ label: 'Prochain jour férié', value: holidayText(holiday, today) });

    const spokenParts: string[] = [];
    if (current)
      spokenParts.push(`${lowerFirst(current.name)} en cours, rentrée ${spoken(current.end)}.`);
    else if (next)
      spokenParts.push(
        `prochaines vacances ${inDays(today, next.start)} : ${lowerFirst(next.name)}, ` +
          `du ${spoken(next.start)} au ${spoken(shift(next.end, -1))}.`,
      );
    else spokenParts.push('aucune période de vacances publiée pour l’instant.');
    if (holiday) spokenParts.push(`Prochain jour férié : ${holidayText(holiday, today)}.`);

    return {
      title: `Vacances scolaires · ${zone}`,
      primaryValue: current ? 'En vacances' : next ? capitalize(inDays(today, next.start)) : null,
      subtitle: current
        ? `${current.name}, rentrée ${spoken(current.end)}`
        : next
          ? `${next.name}, du ${spoken(next.start)} au ${spoken(shift(next.end, -1))}`
          : null,
      description: stale ? 'Dernier calendrier connu, à vérifier.' : null,
      items,
      summary:
        (stale ? 'D’après le dernier calendrier connu, à vérifier. ' : '') +
        `${capitalize(zone)} : ${spokenParts.join(' ')}`,
      sources: ['vacances'],
    };
  },
};

export default addon;
