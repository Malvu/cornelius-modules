/**
 * Trajets en voiture, avec le trafic du moment. Une seule source : Google Routes, qui demande
 * une clé et un compte de facturation. À côté des modules de transports publics, il répond à la
 * question qu'on se pose quand on prend la voiture : combien de temps, et combien de kilomètres.
 */
import { AddonCollectError, type AddonDefinition, type AddonHttpResponse } from '#cornelius/addons';
import { compile } from '#cornelius/validation';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type VoitureConfig = { origine: string | null; destination: string | null };

/** Un trajet routier : la durée, la distance, et ce que le trafic ajoute. */
/**
 * Un trajet routier (durée avec trafic, distance, durée hors trafic), ou l'attente d'une
 * question : sans destination, le module ne peut rien calculer, et le dit plutôt que d'échouer —
 * l'administration teste toute source neuve sans lui poser de question.
 */
type VoitureData =
  | {
      kind: 'trajet';
      depuis: string;
      vers: string;
      dureeMin: number;
      distanceKm: number;
      /**
       * Durée hors trafic, quand Google la donne. Elle peut être *plus longue* que la durée
       * réelle : la nuit, rouler à la vitesse réglementaire prend plus de temps que suivre le flot.
       */
      sansTraficMin: number | null;
    }
  | { kind: 'attente'; message: string };

const routesUrl = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/**
 * Routes API : la remplaçante de Directions API, seule proposée aux nouveaux projets Google.
 * Les durées arrivent en secondes suivies d'un « s » (« 2880s »), et la durée statique permet
 * d'isoler ce que le trafic ajoute.
 */
type RoutesPayload = {
  routes?: {
    duration?: unknown;
    staticDuration?: unknown;
    distanceMeters?: unknown;
  }[];
  error?: { message?: unknown; status?: unknown };
};

const validateRoutes = compile<RoutesPayload>({
  type: 'object',
  properties: {
    routes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          duration: { type: 'string' },
          staticDuration: { type: 'string' },
          distanceMeters: { type: 'number' },
        },
      },
    },
    error: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        status: { type: 'string' },
      },
    },
  },
});

/** « 2880s » donne 2880 secondes. */
function seconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return Number.NaN;
  const match = /^(\d+(?:\.\d+)?)s$/u.exec(value.trim());
  return match ? Number(match[1]) : Number.NaN;
}

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

/** Les deux bouts d'un trajet : « Genève » seul, « de Genève à Zurich », « Chailly > gare ». */
function bothEnds(query: string): { from: string; to: string } | null {
  const match = /^(.*?)\s*(?:>|→|->|\svers\s|\sà\s|\sjusqu'à\s)\s*(.+)$/iu.exec(query.trim());
  if (!match) return null;
  // « de Genève à Zurich » : la préposition reste sur le premier bout, on l'enlève.
  const from = text(match[1], 120).replace(/^(?:de|depuis|d')\s+/iu, '');
  const to = text(match[2], 120);
  return from && to ? { from, to } : null;
}

function minutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

function fail(response: AddonHttpResponse): never {
  if (response.status === 429)
    throw new AddonCollectError('quota', 'Google limite les requêtes.', true);
  if (response.status >= 500)
    throw new AddonCollectError('unavailable', 'Google a rencontré une erreur.', true);
  throw new AddonCollectError('upstream', `Google a répondu ${response.status}.`, false);
}

const addon: AddonDefinition<VoitureConfig, VoitureData> = {
  id: 'voiture_google',
  apiVersion: 1,
  version: '1.0.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'Google Routes',
  display: {
    name: 'Trajets en voiture (trafic)',
    description: 'La durée et la distance en voiture, trafic compris, par Google Routes.',
    icon: 'car',
    group: 'daily',
    keywords: ['voiture', 'trajet', 'trafic', 'routes', 'distance', 'conduire', 'bouchons'],
    example: { label: 'Trajet en voiture', ref: 'voiture' },
    spoken: { head: 'les trajets en voiture', repeats: ['voiture', 'trafic', 'bouchons'] },
  },
  configVersion: 1,
  configSchema,
  configDefaults: { origine: null, destination: null },
  dataSchema,
  dataVersion: 2,
  // Le trafic change vite, mais la question se pose une ou deux fois : deux minutes suffisent.
  freshMs: 2 * 60_000,
  secrets: [
    {
      name: 'googleKey',
      env: 'CORNELIUS_GOOGLE_MAPS_KEY',
      label: 'une clé Google Maps Platform',
    },
  ],
  tools: [
    {
      name: 'trajet',
      description:
        'Calculer un trajet en voiture, avec la durée, la distance et ce que le trafic ajoute. ' +
        'Utiliser pour « combien de temps en voiture ? », « c’est long d’aller à Genève en ' +
        'voiture ? », « je vais au bureau, combien de temps ? ». N’importe quel trajet de Suisse ' +
        'est accepté. query : la destination seule (« Genève ») quand le départ est réglé, ou ' +
        'les deux bouts (« Chailly, Lausanne > Genève », « de Genève à Zurich »). Pour le ' +
        'travail, passer « bureau » ; pour le réglage de départ, « domicile ». Ne jamais inventer ' +
        'une durée ni une distance : si Google ne trouve pas de trajet, le dire.',
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
    const key = context.secret('googleKey');
    if (!key)
      throw new AddonCollectError(
        'config_invalid',
        'Clé Google Maps absente : ajoutez CORNELIUS_GOOGLE_MAPS_KEY dans le fichier .env.',
        false,
      );
    const config = context.config;
    const query = (context.query ?? '').trim();
    // Une source neuve est lue sans question : on répond qu'on attend un trajet, sans erreur.
    if (!query)
      return {
        data: {
          kind: 'attente' as const,
          message: 'Dites deux lieux : « de Chailly à Sion », ou remplissez le départ de la source.',
        },
        empty: true,
      };
    const ends = bothEnds(query);
    // « bureau » ou « domicile » renvoient aux réglages, pour ne pas épeler une adresse. Sans
    // réglage, le mot ne peut pas être cherché comme une adresse : on le dit et on s'arrête.
    const motSeul = (value: string): 'origine' | 'destination' | null => {
      const mot = fold(value);
      if (['bureau', 'travail', 'boulot'].includes(mot)) return 'destination';
      if (['domicile', 'maison', 'ici'].includes(mot)) return 'origine';
      return null;
    };
    const named = (value: string, fallback: string | null): string => {
      const role = motSeul(value);
      if (role === 'destination') return text(config.destination, 120) || value;
      if (role === 'origine') return text(config.origine, 120) || value;
      return text(fallback, 120) || value;
    };
    const origin = named(ends ? ends.from : text(config.origine, 120), config.origine);
    const destination = named(ends ? ends.to : query, null);
    if (motSeul(origin) === 'origine' && !text(config.origine, 120))
      throw new AddonCollectError(
        'config_invalid',
        'Le mot « domicile » n’a pas d’adresse : dites le lieu de départ, ou renseignez le point de départ de la source.',
        false,
      );
    if (motSeul(destination) === 'destination' && !text(config.destination, 120))
      throw new AddonCollectError(
        'config_invalid',
        'Le mot « bureau » n’a pas d’adresse : dites la destination, ou renseignez la destination de la source.',
        false,
      );
    if (!origin)
      throw new AddonCollectError(
        'config_invalid',
        'Indiquez le départ : « de Genève à Zurich », « Chailly, Lausanne > Genève », ou réglez le point de départ de la source.',
        false,
      );
    const response = await context.http.fetch({
      url: routesUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Le masque de champs limite la réponse à ce qui est utile, et allège la facture.
        'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters',
        'X-Goog-Api-Key': key,
      },
      body: JSON.stringify({
        origin: { address: origin },
        destination: { address: destination },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        languageCode: 'fr',
        regionCode: 'CH',
        units: 'METRIC',
      }),
      signal: context.signal,
      timeoutMs: 10_000,
      maxBytes: 256 * 1024,
      cacheMs: 2 * 60_000,
    });
    if (response.status !== 200) fail(response);
    let payload: RoutesPayload;
    try {
      payload = response.json() as RoutesPayload;
    } catch {
      throw new AddonCollectError('malformed', 'Réponse de Google illisible.', false);
    }
    if (!validateRoutes(payload))
      throw new AddonCollectError('malformed', 'Réponse de Google incomprise.', false);
    if (payload.error) {
      const raison = text(payload.error.message, 120) || text(payload.error.status, 40);
      throw new AddonCollectError(
        'not_found',
        `Google ne trouve pas ce trajet : ${raison}.`,
        false,
      );
    }
    const route = payload.routes?.[0];
    const base = seconds(route?.staticDuration);
    const avecTrafic = seconds(route?.duration);
    const distance = Number(route?.distanceMeters);
    if (!Number.isFinite(avecTrafic) || !Number.isFinite(distance))
      throw new AddonCollectError('malformed', 'Google n’a pas donné de durée.', false);
    // La durée annoncée contient le trafic ; la durée statique est l'estimation à trafic nul.
    // Elle peut être plus longue — la nuit, rouler à la vitesse réglementaire prend plus de temps.
    const sansTraficMin = Number.isFinite(base) ? Math.min(1440, minutes(base)) : null;
    return {
      data: {
        kind: 'trajet' as const,
        depuis: origin.slice(0, 120),
        vers: destination.slice(0, 120),
        dureeMin: Math.min(1440, minutes(avecTrafic)),
        distanceKm: Math.round(distance / 100) / 10,
        sansTraficMin,
      },
      source: {
        provider: 'google-routes',
        sourceId: `${origin} > ${destination}`.slice(0, 128),
      },
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
        sources: ['Google Routes'],
      };
    const stale = snapshot.status === 'stale';
    const items = [
      { label: 'Distance', value: `${data.distanceKm.toFixed(1).replace('.', ',')} km` },
    ];
    // La comparaison n'a de sens que si les deux durées diffèrent vraiment.
    const ecart = data.sansTraficMin === null ? 0 : data.dureeMin - data.sansTraficMin;
    if (data.sansTraficMin !== null && Math.abs(ecart) >= 2)
      items.push({ label: 'Sans trafic', value: `${data.sansTraficMin} min` });
    const trafic =
      data.sansTraficMin !== null && ecart >= 2
        ? `, dont ${ecart} minutes de trafic`
        : data.sansTraficMin !== null && ecart <= -2
          ? `, ${-ecart} minutes de moins qu’à trafic nul`
          : '';
    return {
      title: 'En voiture',
      primaryValue: `${data.dureeMin} min`,
      subtitle: `${data.depuis} → ${data.vers}`.slice(0, 120),
      description: stale ? 'Dernier relevé connu, à vérifier.' : null,
      items,
      summary: firstSentence(
        `En voiture de ${data.depuis} à ${data.vers} : ${data.dureeMin} minutes pour ${data.distanceKm.toFixed(1).replace('.', ',')} kilomètres${trafic}.`,
        500,
      ),
      sources: ['Google Routes'],
    };
  },
};

/** Coupe à la première phrase : une carte de miroir se lit d'un coup d'œil. */
function firstSentence(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const period = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (period >= max * 0.4) return cut.slice(0, period + 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export default addon;
