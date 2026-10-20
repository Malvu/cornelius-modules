/** Agenda familial : les prochains rendez-vous d'un agenda partagé, par son lien iCal privé. */
import { AddonCollectError, type AddonDefinition } from '#cornelius/addons';
import { clip } from '../_lib/flux.js';
import { CalendarError, parisDay, readCalendar, zonedTime } from './ics.js';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type AgendaConfig = { url: string; days: number };
type AgendaEvent = {
  title: string;
  location: string | null;
  start: string;
  end: string;
  allDay: boolean;
};
type AgendaData = { name: string | null; days: number; events: AgendaEvent[] };

const dayMs = 86_400_000;
const maxEvents = 40;

const time = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  hour: 'numeric',
  minute: '2-digit',
});
const longDay = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const shortDay = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** « 16 h », « 18 h 30 » : la façon dont on dit l'heure. */
function hour(ms: number): string {
  const [h, m] = time.format(ms).split(':');
  return m === '00' ? `${Number(h)} h` : `${Number(h)} h ${m}`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Minuit à Paris d'un jour compté depuis 1970. */
function midnight(day: number): number {
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
    'Europe/Paris',
  );
}

function dayLabel(day: number, today: number, short = false): string {
  if (day === today) return 'aujourd’hui';
  if (day === today + 1) return 'demain';
  const date = new Date(day * dayMs);
  // Le premier du mois se dit et s'écrit « 1er ».
  return (short ? shortDay : longDay).format(date).replace(/ 1 /u, ' 1er ');
}

type Upcoming = AgendaEvent & { startMs: number; endMs: number; day: number; ongoing: boolean };

/** Rendez-vous pas encore finis, recalculés à chaque présentation. */
function upcoming(data: AgendaData, now: number): { today: number; events: Upcoming[] } {
  const today = parisDay(now);
  const events = data.events
    .map((event) => {
      const startMs = Date.parse(event.start);
      const endMs = Date.parse(event.end);
      const ongoing = startMs <= now;
      // Un événement commencé avant aujourd'hui se range à aujourd'hui.
      return { ...event, startMs, endMs, ongoing, day: Math.max(today, parisDay(startMs)) };
    })
    .filter((event) => event.endMs > now)
    .sort((a, b) => a.day - b.day || Number(b.allDay) - Number(a.allDay) || a.startMs - b.startMs);
  return { today, events };
}

/** « à 16 h », « toute la journée », « jusqu'au dimanche 25 octobre », « en cours, jusqu'à 17 h ». */
function when(event: Upcoming, today: number): string {
  if (event.allDay) {
    const lastDay = parisDay(event.endMs - 1);
    return lastDay > event.day ? `jusqu’au ${dayLabel(lastDay, today)}` : 'toute la journée';
  }
  if (event.ongoing) return `en cours, jusqu’à ${hour(event.endMs)}`;
  return `à ${hour(event.startMs)}`;
}

function cardTime(event: Upcoming, today: number): string {
  const day = capitalize(dayLabel(event.day, today, true));
  if (event.allDay)
    return parisDay(event.endMs - 1) > event.day ? `${day} · plusieurs jours` : `${day} · journée`;
  return event.ongoing ? `${day} · en cours` : `${day} ${hour(event.startMs)}`;
}

function joinSpoken(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} et ${items.at(-1)}`;
}

const addon: AddonDefinition<AgendaConfig, AgendaData> = {
  id: 'agenda',
  apiVersion: 1,
  version: '1.0.0',
  sourceLabel: 'Agenda',
  configVersion: 1,
  configSchema,
  configDefaults: { url: '', days: 7 },
  dataVersion: 1,
  dataSchema,
  freshMs: 15 * 60 * 1000,
  tools: [
    {
      name: 'read',
      description:
        'Lire les prochains rendez-vous de l’agenda configuré et afficher sa carte. Utiliser pour ' +
        '« qu’est-ce qu’on a demain ? », « c’est quand le dentiste ? » ou « mon agenda de la semaine ».',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
    },
  ],
  async collect(context) {
    const { days } = context.config;
    // « webcal:// » n'est qu'un « https:// » que les navigateurs ouvrent dans un agenda.
    const url = context.config.url.trim().replace(/^webcal:\/\//iu, 'https://');
    const now = context.now();
    const response = await context.http.fetch({
      url,
      method: 'GET',
      headers: { Accept: 'text/calendar, */*' },
      signal: context.signal,
      timeoutMs: 15_000,
      maxBytes: 8 * 1024 * 1024,
    });
    // Le lien est un secret : aucun message ne le reprend.
    if (response.status === 401 || response.status === 403)
      throw new AddonCollectError(
        'forbidden',
        'L’agenda refuse l’accès : le lien privé a peut-être été réinitialisé.',
      );
    if (response.status === 404 || response.status === 410)
      throw new AddonCollectError('not_found', 'Agenda introuvable : vérifier le lien privé.');
    if (response.status === 429)
      throw new AddonCollectError(
        'quota',
        'Le service d’agenda limite les demandes, réessayer plus tard.',
        true,
      );
    if (response.status >= 500)
      throw new AddonCollectError('unavailable', 'Le service d’agenda ne répond pas.', true);
    if (response.status !== 200)
      throw new AddonCollectError(
        'upstream',
        `Agenda : réponse HTTP ${response.status} inattendue.`,
      );
    let calendar;
    try {
      calendar = readCalendar(response.text(), now, midnight(parisDay(now) + days));
    } catch (error) {
      if (error instanceof CalendarError)
        throw new AddonCollectError(
          'malformed',
          'Ce lien ne donne pas un agenda iCal : prendre l’adresse au format iCal.',
        );
      throw error;
    }
    const events: AgendaEvent[] = calendar.occurrences.slice(0, maxEvents).map((occurrence) => ({
      title: clip(occurrence.title, 200),
      location: occurrence.location ? clip(occurrence.location, 200) : null,
      start: new Date(occurrence.start).toISOString(),
      end: new Date(Math.max(occurrence.end, occurrence.start + 1)).toISOString(),
      allDay: occurrence.allDay,
    }));
    return {
      data: { name: calendar.name ? clip(calendar.name, 120) : null, days, events },
      // Une semaine sans rendez-vous est une réponse utile, pas une source vide.
      source: { provider: 'ical', sourceId: context.instance.ref ?? context.instance.id },
    };
  },
  ambient: {
    present(snapshot, context) {
      const data = snapshot.data;
      if (!data) throw new Error('Aucun agenda à afficher.');
      const { today, events } = upcoming(data, context.now());
      return {
        layout: 'list',
        title: 'Agenda',
        value: events.length ? null : 'Rien de prévu',
        subtitle: null,
        items: events.slice(0, 3).map((event) => ({
          label: cardTime(event, today),
          value: clip(event.title, 160),
        })),
      };
    },
  },
  present(snapshot, context) {
    const data = snapshot.data;
    if (!data) throw new Error('Aucun agenda à présenter.');
    const now = context.now();
    const stale = snapshot.status === 'stale';
    const { today, events } = upcoming(data, now);
    const horizon = data.days === 1 ? 'aujourd’hui' : `dans les ${data.days} prochains jours`;
    const first = events[0];
    // À l'oral : trois jours au plus, six rendez-vous au plus.
    const spokenDays: string[] = [];
    let told = 0;
    for (const day of [...new Set(events.map((event) => event.day))].slice(0, 3)) {
      const ofDay = events.filter((event) => event.day === day).slice(0, Math.max(0, 6 - told));
      if (!ofDay.length) break;
      told += ofDay.length;
      spokenDays.push(
        `${capitalize(dayLabel(day, today))} : ${joinSpoken(ofDay.map((event) => `${event.title} ${when(event, today)}`))}.`,
      );
    }
    const more = events.length - told;
    return {
      title: clip(data.name ? `Agenda · ${data.name}` : 'Agenda', 80),
      primaryValue: first ? clip(first.title, 120) : 'Rien de prévu',
      subtitle: first
        ? clip(`${capitalize(dayLabel(first.day, today))}, ${when(first, today)}`, 120)
        : capitalize(horizon),
      description: stale
        ? 'Dernier agenda connu : un rendez-vous a pu changer depuis.'
        : first?.location
          ? clip(first.location, 500)
          : null,
      items: events.slice(1, 6).map((event) => ({
        label: cardTime(event, today),
        value: clip(event.location ? `${event.title} · ${event.location}` : event.title, 160),
      })),
      summary:
        (stale ? 'D’après le dernier agenda connu, à vérifier. ' : '') +
        (events.length
          ? spokenDays.join(' ') +
            (more > 0 ? ` Et ${more} autre${more > 1 ? 's' : ''} ${horizon}.` : '')
          : `Rien de prévu ${horizon}.`),
      sources: ['agenda'],
    };
  },
};

export default addon;
