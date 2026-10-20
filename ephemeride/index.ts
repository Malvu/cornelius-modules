/** Éphéméride : ce qui s'est passé un jour comme aujourd'hui, d'après Wikipédia. */
import { AddonCollectError, type AddonDefinition } from '#cornelius/addons';
import { compile } from '#cornelius/validation';
import { clip } from '../_lib/flux.js';
import { dateIn, nextMidnight, wallIn } from '../_lib/temps.js';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type EphemerideConfig = { count: number };
type Event = { year: number; text: string; page: string | null };
type EphemerideData = { day: string; events: Event[] };

type Payload = { selected: { text: string; year?: number; pages?: { title?: string }[] }[] };

const baseUrl = 'https://fr.wikipedia.org/api/rest_v1/feed/onthisday/selected';

const validatePayload = compile<Payload>({
  type: 'object',
  required: ['selected'],
  properties: {
    selected: {
      type: 'array',
      items: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string' },
          year: { type: 'integer' },
          pages: { type: 'array' },
        },
      },
    },
  },
});

const dayName = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
});

/** « 10-20 » pour le 20 octobre, dans le fuseau du foyer. */
function monthDay(now: number, zone: string): string {
  return dateIn(now, zone).slice(5);
}

function spokenDay(day: string): string {
  const [month, date] = day.split('-').map(Number);
  return dayName.format(Date.UTC(2000, month! - 1, date!)).replace(/^1 /u, '1er ');
}

/** Un anniversaire rond se retient mieux : 100, 50, 25, 10, puis 5 ans. */
function roundness(years: number): number {
  for (const [step, score] of [
    [100, 5],
    [50, 4],
    [25, 3],
    [10, 2],
    [5, 1],
  ] as const)
    if (years % step === 0) return score;
  return 0;
}

function yearLabel(year: number): string {
  return year > 0 ? String(year) : `${1 - year} av. J.-C.`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Le texte de Wikipédia suit « En 1975, » : il commence en minuscule et finit par un point. */
function sentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/gu, ' ');
  return /[.!?…»]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

function ranked(data: EphemerideData, now: number, zone: string): (Event & { years: number })[] {
  const current = wallIn(now, zone).year;
  return data.events
    .map((event) => ({ ...event, years: current - event.year }))
    .filter((event) => event.years >= 1)
    .sort((a, b) => roundness(b.years) - roundness(a.years) || a.years - b.years);
}

const addon: AddonDefinition<EphemerideConfig, EphemerideData> = {
  id: 'ephemeride',
  apiVersion: 1,
  version: '1.1.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'Éphéméride Wikipédia',
  display: {
    name: 'Éphéméride',
    description: 'Ce qui s’est passé un jour comme aujourd’hui, d’après Wikipédia.',
    icon: 'scroll-text',
    keywords: ['éphéméride', 'histoire', 'ce jour-là', 'anniversaire', 'wikipédia'],
    example: { label: 'Éphéméride', ref: 'jour' },
    spoken: { head: 'l’éphéméride', repeats: ['ephemeride', 'histoire'] },
  },
  configVersion: 1,
  configSchema,
  configDefaults: { count: 3 },
  dataVersion: 1,
  dataSchema,
  freshMs: 24 * 60 * 60 * 1000,
  tools: [
    {
      name: 'read',
      description:
        'Lire ce qui s’est passé un jour comme aujourd’hui dans l’histoire et afficher sa carte. ' +
        'Utiliser pour « qu’est-ce qui s’est passé un 20 octobre ? » ou « l’éphéméride du jour ».',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
    },
  ],
  async collect(context) {
    const day = monthDay(context.now(), context.timeZone);
    const response = await context.http.fetch({
      url: `${baseUrl}/${day.replace('-', '/')}`,
      method: 'GET',
      // Wikimedia exige qu'un programme se présente : le cœur envoie « Cornelius/x.y.z ».
      headers: { Accept: 'application/json' },
      signal: context.signal,
      timeoutMs: 8000,
      maxBytes: 1024 * 1024,
    });
    if (response.status === 429)
      throw new AddonCollectError(
        'quota',
        'Wikipédia limite les demandes, réessayer plus tard.',
        true,
      );
    if (response.status >= 500)
      throw new AddonCollectError('unavailable', 'Wikipédia ne répond pas.', true);
    if (response.status !== 200)
      throw new AddonCollectError(
        'upstream',
        `Wikipédia : réponse HTTP ${response.status} inattendue.`,
      );
    let payload: unknown;
    try {
      payload = response.json();
    } catch {
      throw new AddonCollectError('malformed', 'Wikipédia : réponse illisible.');
    }
    if (!validatePayload(payload))
      throw new AddonCollectError('malformed', 'Wikipédia : réponse inattendue.');
    const events: Event[] = payload.selected
      .filter((event) => Number.isInteger(event.year) && event.text.trim())
      .map((event) => ({
        year: event.year!,
        text: clip(event.text.trim().replace(/\s+/gu, ' '), 400),
        page: event.pages?.[0]?.title?.slice(0, 200) ?? null,
      }));
    // Les plus marquants d'abord, au rang qu'ils auront aujourd'hui.
    const data: EphemerideData = { day, events };
    data.events = ranked(data, context.now(), context.timeZone)
      .slice(0, context.config.count)
      .map(({ years: _years, ...event }) => event);
    return {
      data,
      empty: data.events.length === 0,
      // Les événements valent pour la journée : relus à minuit, pas avant.
      freshMs: Math.max(5 * 60_000, nextMidnight(context.now(), context.timeZone) - context.now()),
      source: { provider: 'wikipedia-fr', sourceId: day },
    };
  },
  ambient: {
    present(snapshot, context) {
      const data = snapshot.data;
      if (!data?.events.length) throw new Error('Aucun événement à afficher.');
      const events = ranked(data, context.now(), context.timeZone).slice(0, 3);
      return {
        layout: 'list',
        showCollectedAt: false,
        title: `Un ${spokenDay(data.day)}`,
        value: null,
        subtitle: null,
        items: events.map((event) => ({
          label: yearLabel(event.year),
          value: clip(capitalize(sentence(event.text)), 160),
        })),
      };
    },
  },
  present(snapshot, context) {
    const data = snapshot.data;
    if (!data?.events.length) throw new Error('Aucun événement à présenter.');
    const events = ranked(data, context.now(), context.timeZone);
    const first = events[0]!;
    const today = monthDay(context.now(), context.timeZone) === data.day;
    const when = today ? 'Un jour comme aujourd’hui' : `Un ${spokenDay(data.day)}`;
    return {
      title: `Éphéméride · ${spokenDay(data.day)}`,
      primaryValue: `Il y a ${first.years} an${first.years > 1 ? 's' : ''}`,
      subtitle: `En ${yearLabel(first.year)}`,
      description: clip(capitalize(sentence(first.text)), 500),
      items: events.slice(1, 5).map((event) => ({
        label: yearLabel(event.year),
        value: clip(capitalize(sentence(event.text)), 160),
      })),
      summary: `${when}, il y a ${first.years} an${first.years > 1 ? 's' : ''}, en ${yearLabel(first.year)} : ${sentence(first.text)}`,
      sources: ['ephemeride'],
    };
  },
};

export default addon;
