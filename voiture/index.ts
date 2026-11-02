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
/**
 * Un trajet routier (durée, distance), ou l'attente d'une question : sans destination, le module
 * ne peut rien calculer, et le dit plutôt que d'échouer — l'administration teste toute source
 * neuve sans lui poser de question.
 */
type VoitureData =
  | {
      kind: 'trajet';
      depuis: string;
      vers: string;
      dureeMin: number;
      distanceKm: number;
    }
  | { kind: 'attente'; message: string };

/**
 * Adresses : swisstopo, la donnée officielle des adresses suisses, sans clé ni compte.
 * Routes : OSRM, le calculateur d'OpenStreetMap, sans compte non plus.
 */
const searchUrl = 'https://api3.geo.admin.ch/rest/services/api/SearchServer';
const routeUrl = 'https://router.project-osrm.org/route/v1/driving';

type SearchPayload = {
  results?: { attrs?: { lat?: unknown; lon?: unknown; label?: unknown; detail?: unknown } }[];
};

const validateSearch = compile<SearchPayload>({
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          attrs: {
            type: 'object',
            properties: {
              lat: { type: 'number' },
              lon: { type: 'number' },
              label: { type: 'string' },
              detail: { type: 'string' },
            },
          },
        },
      },
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
 * swisstopo entoure la localité de balises `<b>` : la balise devient une virgule, on retire le
 * code postal, et la carte affiche « Avenue de Chailly 1, Lausanne » plutôt qu'une suite de
 * chiffres qui ne dit rien à personne.
 */
function plainLabel(raw: string): string {
  return (
    raw
      .replace(/<b>/gu, ', ')
      .replace(/<[^>]*>/gu, '')
      // Un code postal suisse fait quatre chiffres, collé devant la localité.
      .replace(/\b\d{4}\b/gu, ' ')
      .replace(/&amp;/gu, '&')
      .replace(/&quot;/gu, '"')
      .replace(/&apos;/gu, "'")
      .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
      .replace(/\s*,\s*/gu, ', ')
      .replace(/^,\s*/u, '')
      .replace(/\s+/gu, ' ')
      .trim()
  );
}

/**
 * Libellé lisible d'un résultat : « Genève », « Chailly, Montblesson ». Le pays arrive parfois
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
    // Une source neuve est lue sans question : on répond qu'on attend un trajet, sans erreur.
    if (!query)
      return {
        data: {
          kind: 'attente' as const,
          message:
            'Dites deux lieux : « de Chailly à Sion », ou remplissez le départ de la source.',
        },
        empty: true,
      };
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
        searchText: address,
        type: 'locations',
        // Adresses avec numéro, et localités : c'est ce que demande un trajet en voiture.
        origins: 'address,gg25',
        limit: '5',
        sr: '4326',
      });
      const response = await context.http.fetch({
        url: `${searchUrl}?${params.toString()}`,
        method: 'GET',
        signal: context.signal,
        timeoutMs: 8000,
        maxBytes: 128 * 1024,
        // Une adresse ne bouge pas : dix minutes de cache suffisent à ne pas la redemander.
        cacheMs: 10 * 60_000,
      });
      if (response.status !== 200) fail(response, 'swisstopo');
      let payload: unknown;
      try {
        payload = response.json();
      } catch {
        throw new AddonCollectError('malformed', 'Réponse de swisstopo illisible.', false);
      }
      if (!validateSearch(payload)) return null;
      const attrs = payload.results?.[0]?.attrs;
      const lat = Number(attrs?.lat);
      const lon = Number(attrs?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon, label: shortLabel(plainLabel(text(attrs?.label, 200)), address) };
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
    // Un 400 d'OSRM ne veut pas dire « service en panne » mais « pas de route par là » :
    // coordonnées hors réseau routier, par exemple un point au milieu d'un lac.
    if (response.status === 400 || response.status === 404)
      throw new AddonCollectError(
        'not_found',
        `Aucune route entre ${depart.label} et ${arrivee.label}.`,
        false,
      );
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
    if (data.kind === 'attente')
      return {
        title: 'En voiture',
        primaryValue: 'Où ?',
        subtitle: 'Dites le départ et l’arrivée',
        description: null,
        items: [],
        summary: data.message,
        sources: ['OpenStreetMap', 'OSRM'],
      };
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
