/**
 * Trajets en voiture, entièrement gratuits : OpenStreetMap pour retrouver les adresses, OSRM pour
 * calculer la route. Aucune clé, aucun compte, rien à payer. La durée ne tient pas compte du
 * trafic, d'où le second module pour qui y tient.
 */
import { AddonCollectError, type AddonDefinition, type AddonHttpResponse } from '#cornelius/addons';
import { compile } from '#cornelius/validation';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type VoitureConfig = { origine: string | null; destination: string | null };

/** Un trajet routier : la durée et la distance, sans trafic. */
type VoitureData = {
  kind: 'trajet';
  depuis: string;
  vers: string;
  dureeMin: number;
  distanceKm: number;
};

const searchUrl = 'https://nominatim.openstreetmap.org/search';
const routeUrl = 'https://router.project-osrm.org/route/v1/driving';

type SearchPayload = { lat?: unknown; lon?: unknown; display_name?: unknown }[];

const validateSearch = compile<SearchPayload>({
  type: 'array',
  items: {
    type: 'object',
    properties: {
      lat: { type: 'string' },
      lon: { type: 'string' },
      display_name: { type: 'string' },
    },
  },
});

type RoutePayload = {
  code?: unknown;
  routes?: { duration?: unknown; distance?: unknown }[];
};

const validateRoute = compile<RoutePayload>({
  type: 'object',
  properties: {
    code: { type: 'string' },
    routes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          duration: { type: 'number' },
          distance: { type: 'number' },
        },
      },
    },
  },
});

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

/**
 * Libellé lisible d'un résultat Nominatim : « Genève », « Chailly, Montblesson ». Le pays arrive
 * en quatre langues (« Schweiz/Suisse/Svizzera/Svizra ») et le district n'apprend rien.
 */
function shortLabel(raw: string, fallback: string): string {
  const partes = raw
    .split(',')
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.length > 0 &&
        !/schweiz|suisse|svizzera|svizra|switzerland|france|italia|österreich|austria|deutschland/iu.test(
          part,
        ),
    );
  return (partes.slice(0, 2).join(', ') || fallback).slice(0, 120);
}

/** Les deux bouts : « Genève » seul, « de Genève à Zurich », « Chailly > gare ». */
function bothEnds(query: string): { from: string; to: string } | null {
  const match = /^(.*?)\s*(?:>|→|->|\svers\s|\sà\s|\sjusqu'à\s)\s*(.+)$/iu.exec(query.trim());
  if (!match) return null;
  const from = text(match[1], 120).replace(/^(?:de|depuis|d')\s+/iu, '');
  const to = text(match[2], 120);
  return from && to ? { from, to } : null;
}

function fail(response: AddonHttpResponse, qui: string): never {
  if (response.status === 429)
    throw new AddonCollectError('quota', `${qui} limite les requêtes.`, true);
  if (response.status >= 500)
    throw new AddonCollectError('unavailable', `${qui} a rencontré une erreur.`, true);
  throw new AddonCollectError('upstream', `${qui} a répondu ${response.status}.`, false);
}

const addon: AddonDefinition<VoitureConfig, VoitureData> = {
  id: 'voiture',
  apiVersion: 1,
  version: '1.0.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'OpenStreetMap et OSRM',
  display: {
    name: 'Trajets en voiture (gratuit)',
    description: 'La durée et la distance en voiture, sans clé ni compte, par OpenStreetMap.',
    icon: 'car',
    group: 'daily',
    keywords: ['voiture', 'trajet', 'routes', 'distance', 'conduire', 'gratuit'],
    example: { label: 'Trajet en voiture', ref: 'voiture' },
    spoken: { head: 'les trajets en voiture', repeats: ['voiture', 'trajet'] },
  },
  configVersion: 1,
  configSchema,
  configDefaults: { origine: null, destination: null },
  dataSchema,
  dataVersion: 1,
  freshMs: 5 * 60_000,
  tools: [
    {
      name: 'trajet',
      description:
        'Calculer un trajet en voiture, avec la durée et la distance, sans tenir compte du ' +
        'trafic. Utiliser pour « combien de temps en voiture ? », « c’est loin d’aller à ' +
        'Genève ? ». N’importe quel trajet de Suisse est accepté. query : la destination seule ' +
        '(« Genève ») quand le départ est réglé, ou les deux bouts (« de Genève à Zurich », ' +
        '« Chailly, Lausanne > Sion »). Pour le travail, passer « bureau » ; pour le départ ' +
        'réglé, « domicile ». Ne jamais inventer une durée : si aucune route n’est trouvée, le ' +
        'dire.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef', 'query'],
        properties: {
          instanceRef: { type: ['string', 'null'] },
          query: { type: 'string' },
        },
      },
      query: { maxLength: 120 },
    },
  ],
  async collect(context) {
    const config = context.config;
    const query = (context.query ?? '').trim();
    if (!query) throw new AddonCollectError('invalid_params', 'Précisez une destination.', false);
    const ends = bothEnds(query);
    // « bureau » et « domicile » renvoient aux réglages, pour ne pas épeler une adresse. Sans
    // réglage, le mot ne peut pas être cherché comme une adresse : on le dit et on s'arrête.
    const motSeul = (value: string): 'origine' | 'destination' | null => {
      const mot = fold(value);
      if (['bureau', 'travail', 'boulot'].includes(mot)) return 'destination';
      if (['domicile', 'maison', 'ici'].includes(mot)) return 'origine';
      return null;
    };
    const named = (value: string): string => {
      const role = motSeul(value);
      if (role === 'destination') return text(config.destination, 120) || value;
      if (role === 'origine') return text(config.origine, 120) || value;
      return value;
    };
    const from = named(ends ? ends.from : text(config.origine, 120));
    const to = named(ends ? ends.to : query);
    if (motSeul(from) === 'origine' && !text(config.origine, 120))
      throw new AddonCollectError(
        'config_invalid',
        'Le mot « domicile » n’a pas d’adresse : dites le lieu de départ, ou renseignez le point de départ de la source.',
        false,
      );
    if (motSeul(to) === 'destination' && !text(config.destination, 120))
      throw new AddonCollectError(
        'config_invalid',
        'Le mot « bureau » n’a pas d’adresse : dites la destination, ou renseignez la destination de la source.',
        false,
      );
    if (!from)
      throw new AddonCollectError(
        'config_invalid',
        'Indiquez le départ : « de Genève à Zurich », ou réglez le point de départ de la source.',
        false,
      );
    const locate = async (address: string) => {
      const params = new URLSearchParams({
        q: address,
        format: 'jsonv2',
        // Cinq résultats, pas un : « Chailly, Lausanne » en a plusieurs, et le premier n'est pas
        // toujours celui qu'on veut. On garde celui qui reprend le plus de mots demandés.
        limit: '5',
        countrycodes: 'ch,fr,it,de,at',
      });
      const response = await context.http.fetch({
        url: `${searchUrl}?${params.toString()}`,
        method: 'GET',
        // La politique de Nominatim demande un agent identifiable et une cadence douce.
        headers: { 'User-Agent': 'Cornelius/1.0 (miroir familial)' },
        signal: context.signal,
        timeoutMs: 8000,
        maxBytes: 128 * 1024,
        cacheMs: 10 * 60_000,
      });
      if (response.status !== 200) fail(response, 'OpenStreetMap');
      let payload: unknown;
      try {
        payload = response.json();
      } catch {
        throw new AddonCollectError('malformed', 'Réponse d’OpenStreetMap illisible.', false);
      }
      if (!validateSearch(payload) || payload.length === 0) return null;
      const mots = fold(address)
        .split(' ')
        .filter((mot) => mot.length > 2);
      const scores = payload.map((entry) => {
        const libelle = fold(text(entry.display_name, 200));
        return { entry, score: mots.filter((mot) => libelle.includes(mot)).length };
      });
      scores.sort((a, b) => b.score - a.score);
      const first = scores[0]?.entry;
      if (!first) return null;
      const lat = Number(first.lat);
      const lon = Number(first.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon, label: shortLabel(text(first.display_name, 200), address) };
    };
    const depart = await locate(from);
    if (!depart)
      throw new AddonCollectError('not_found', `Aucun lieu trouvé pour « ${from} ».`, false);
    const arrivee = await locate(to);
    if (!arrivee)
      throw new AddonCollectError('not_found', `Aucun lieu trouvé pour « ${to} ».`, false);
    const coords = `${depart.lon},${depart.lat};${arrivee.lon},${arrivee.lat}`;
    const response = await context.http.fetch({
      url: `${routeUrl}/${coords}?overview=false&alternatives=false&steps=false`,
      method: 'GET',
      signal: context.signal,
      timeoutMs: 10_000,
      maxBytes: 128 * 1024,
      cacheMs: 5 * 60_000,
    });
    if (response.status !== 200) fail(response, 'OSRM');
    let payload: RoutePayload;
    try {
      payload = response.json() as RoutePayload;
    } catch {
      throw new AddonCollectError('malformed', 'Réponse d’OSRM illisible.', false);
    }
    if (!validateRoute(payload))
      throw new AddonCollectError('malformed', 'Réponse d’OSRM incomprise.', false);
    const route = payload.routes?.[0];
    const duree = Number(route?.duration);
    const distance = Number(route?.distance);
    if (payload.code !== 'Ok' || !Number.isFinite(duree) || !Number.isFinite(distance))
      throw new AddonCollectError(
        'not_found',
        `Aucune route entre ${depart.label} et ${arrivee.label}.`,
        false,
      );
    return {
      data: {
        kind: 'trajet' as const,
        depuis: depart.label.slice(0, 120),
        vers: arrivee.label.slice(0, 120),
        dureeMin: Math.min(1440, Math.max(1, Math.round(duree / 60))),
        distanceKm: Math.round(distance / 100) / 10,
      },
      source: { provider: 'osrm', sourceId: `${depart.label} > ${arrivee.label}`.slice(0, 128) },
    };
  },
  present(snapshot) {
    const data = snapshot.data;
    if (!data) throw new Error('Aucun trajet à présenter.');
    const stale = snapshot.status === 'stale';
    return {
      title: 'En voiture',
      primaryValue: `${data.dureeMin} min`,
      subtitle: `${data.depuis} → ${data.vers}`.slice(0, 120),
      description: stale ? 'Dernier relevé connu, à vérifier.' : null,
      items: [{ label: 'Distance', value: `${data.distanceKm.toFixed(1).replace('.', ',')} km` }],
      summary: `En voiture de ${data.depuis} à ${data.vers} : ${data.dureeMin} minutes pour ${data.distanceKm.toFixed(1).replace('.', ',')} kilomètres, hors trafic.`,
      sources: ['OpenStreetMap', 'OSRM'],
    };
  },
};

export default addon;
