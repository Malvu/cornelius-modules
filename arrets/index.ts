/**
 * Arrêts et itinéraires : les lignes qui desservent un arrêt de la ville, et le trajet entre deux
 * lieux de cette ville. Une seule source couvre la ville entière ; la voix nomme l'arrêt qu'elle
 * veut, ou les deux bouts du trajet.
 */
import { AddonCollectError, type AddonDefinition, type AddonHttpResponse } from '#cornelius/addons';
import { compile } from '#cornelius/validation';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type ArretsConfig = { ville: string | null; arret: string; limite: number };

type Ligne = {
  ligne: string;
  direction: string;
  depart: string;
  retardMin: number;
  voie: string | null;
};

/** Un tronçon de l'itinéraire : la ligne prise, d'où à où, et quand. */
type Etape = {
  ligne: string;
  depuis: string;
  vers: string;
  depart: string;
  arrive: string;
  voie: string | null;
};

/** Un itinéraire proposé : heures, durée, correspondances, lignes et détail des tronçons. */
type Trajet = {
  depart: string;
  arrive: string;
  dureeMin: number;
  correspondances: number;
  lignes: string[];
  etapes: Etape[];
};

type ArretsData =
  | { kind: 'stop'; arret: string; ville: string; lignes: Ligne[] }
  | { kind: 'trajet'; depuis: string; vers: string; trajets: Trajet[] };

/** Ce qu'on retient d'un départ du flux, avant regroupement par ligne et direction. */
type Depart = {
  ligne: string;
  direction: string;
  depart: string;
  retardMin: number;
  voie: string | null;
};

type Station = { id: string | null; name: string };

const locationsUrl = 'https://transport.opendata.ch/v1/locations';
const stationboardUrl = 'https://transport.opendata.ch/v1/stationboard';
const connectionsUrl = 'https://transport.opendata.ch/v1/connections';

type LocationsPayload = {
  stations?: { id?: unknown; name?: unknown; score?: unknown }[];
};

type StationboardPayload = {
  station?: { name?: unknown };
  stationboard?: {
    category?: unknown;
    number?: unknown;
    name?: unknown;
    to?: unknown;
    stop?: { departure?: unknown; delay?: unknown; platform?: unknown };
  }[];
};

type ConnectionsPayload = {
  connections?: {
    from?: { station?: unknown; departure?: unknown };
    to?: { station?: unknown; arrival?: unknown };
    duration?: unknown;
    transfers?: unknown;
    products?: unknown;
    sections?: {
      departure?: {
        station?: { name?: unknown };
        departure?: unknown;
        platform?: unknown;
      };
      arrival?: { station?: { name?: unknown }; arrival?: unknown };
      journey?: { category?: unknown; number?: unknown; name?: unknown };
      walk?: { duration?: unknown };
    }[];
  }[];
};

const validateLocations = compile<LocationsPayload>({
  type: 'object',
  properties: {
    stations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: ['string', 'null'] },
          name: { type: ['string', 'null'] },
        },
      },
    },
  },
});

const validateStationboard = compile<StationboardPayload>({
  type: 'object',
  properties: {
    station: {
      type: 'object',
      properties: { name: { type: ['string', 'null'] } },
    },
    stationboard: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: ['string', 'null'] },
          number: { type: ['string', 'null'] },
          name: { type: ['string', 'null'] },
          to: { type: ['string', 'null'] },
          stop: {
            type: 'object',
            properties: {
              departure: { type: ['string', 'null'] },
              delay: { type: ['number', 'string', 'null'] },
              platform: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
  },
});

const validateConnections = compile<ConnectionsPayload>({
  type: 'object',
  properties: {
    connections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: {
            type: 'object',
            properties: { departure: { type: ['string', 'null'] } },
          },
          to: {
            type: 'object',
            properties: { arrival: { type: ['string', 'null'] } },
          },
          duration: { type: ['string', 'null'] },
          transfers: { type: ['integer', 'null'] },
          products: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
});

/** Texte comparable : accents retirés, minuscules, espaces simples. */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Horodatage suisse « 2026-10-29T00:19:00+0100 », normalisé en ISO. */
function normalizeIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(trimmed)) return null;
  const iso = /([+-]\d{2})(\d{2})$/u.test(trimmed)
    ? trimmed.replace(/([+-]\d{2})(\d{2})$/u, '$1:$2')
    : trimmed;
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-CH', { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

/** « B » + « 7 » donne « B 7 » ; « m » + « 2 » donne « m2 ». */
function lineName(category: string, number: string, fallback: string): string {
  if (!number) return category || fallback;
  const cat = category.trim();
  if (!cat) return number;
  return number.toLowerCase().startsWith(cat.toLowerCase()) ? number : `${cat} ${number}`;
}

/** Coupe à la première phrase : une carte de miroir se lit d'un coup d'œil. */
function firstSentence(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const period = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('.\n'),
    cut.lastIndexOf('! '),
    cut.lastIndexOf('? '),
  );
  if (period >= max * 0.4) return cut.slice(0, period + 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** « 00d00:49:00 » donne 49 minutes. */
function durationMinutes(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const match = /(?:(\d+)d)?(\d{1,2}):(\d{2})(?::(\d{2}))?/u.exec(value);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 1440 + Number(match[2]) * 60 + Number(match[3]);
}

function fail(response: AddonHttpResponse): never {
  if (response.status === 429)
    throw new AddonCollectError('quota', 'transport.opendata.ch limite les requêtes.', true);
  if (response.status >= 500)
    throw new AddonCollectError(
      'unavailable',
      'transport.opendata.ch a rencontré une erreur.',
      true,
    );
  throw new AddonCollectError(
    'upstream',
    `transport.opendata.ch a répondu ${response.status}.`,
    false,
  );
}

function payloadOf(response: AddonHttpResponse): unknown {
  try {
    return response.json();
  } catch {
    throw new AddonCollectError('malformed', 'Réponse des transports illisible.');
  }
}

type CollectContext = Parameters<
  NonNullable<AddonDefinition<ArretsConfig, ArretsData>['collect']>
>[0];

/**
 * Départs d'un arrêt, d'après l'identifiant quand on l'a, sinon son nom exact.
 * On demande large (60) pour voir toutes les directions ; on ne garde que l'avenir.
 */
async function departuresOf(
  context: CollectContext,
  station: Station,
  now: number,
): Promise<{ name: string; departures: Depart[] }> {
  const params = new URLSearchParams({ limit: '60' });
  if (station.id) params.set('id', station.id);
  else params.set('station', station.name);
  const response = await context.http.fetch({
    url: `${stationboardUrl}?${params.toString()}`,
    method: 'GET',
    signal: context.signal,
    timeoutMs: 8000,
    maxBytes: 512 * 1024,
    // Plusieurs questions rapprochées sur le même arrêt ne redemandent pas le flux.
    cacheMs: 45_000,
  });
  if (response.status !== 200) fail(response);
  const payload = payloadOf(response);
  if (!validateStationboard(payload) || !Array.isArray(payload.stationboard))
    throw new AddonCollectError('malformed', 'Réponse sans tableau des départs.');
  const name = text(payload.station?.name, 80) || station.name;
  const departures: Depart[] = [];
  for (const entry of payload.stationboard) {
    const departure = normalizeIso(entry.stop?.departure);
    const destination = text(entry.to, 80);
    if (!departure || !destination) continue;
    // Un départ déjà passé n'est pas une information : on l'ignore.
    if (new Date(departure).getTime() < now - 60_000) continue;
    const delay = Number(entry.stop?.delay);
    departures.push({
      ligne: lineName(text(entry.category, 12), text(entry.number, 12), text(entry.name, 20)).slice(
        0,
        40,
      ),
      direction: destination,
      depart: departure,
      retardMin: Number.isFinite(delay) && delay > 0 ? Math.min(240, Math.round(delay)) : 0,
      voie: text(entry.stop?.platform, 20) || null,
    });
  }
  return { name, departures };
}

/** Une entrée par ligne et par direction : la première, la plus proche. */
function groupLines(departures: Depart[], limite: number): Ligne[] {
  const first = new Map<string, Ligne>();
  for (const departure of departures) {
    const key = `${departure.ligne}|${departure.direction}`;
    const known = first.get(key);
    if (!known || departure.depart < known.depart) first.set(key, departure);
  }
  return [...first.values()]
    .sort((a, b) => (a.depart < b.depart ? -1 : a.depart > b.depart ? 1 : 0))
    .slice(0, limite);
}

/**
 * Gares que le réseau nomme à l'allemand alors qu'on les dit en français. Sans ça, « Berne »
 * tombe sur « Berneuse » à Leysin et « Bâle » ne trouve rien.
 */
const SWISS_ALIASES: Record<string, string> = {
  berne: 'Bern',
  bale: 'Basel',
  lucerne: 'Luzern',
  zurich: 'Zürich',
  soleure: 'Solothurn',
  bienne: 'Biel/Bienne',
  thoune: 'Thun',
  viege: 'Visp',
  brigue: 'Brig',
  coire: 'Chur',
  'saint gall': 'St. Gallen',
  saintgallen: 'St. Gallen',
};

/** Arrêt le plus probable pour ce que dit la personne, nom français compris. */
async function findStop(
  context: CollectContext,
  ville: string,
  query: string,
): Promise<Station | null> {
  // Le nom français d'une gare germanophone est une meilleure piste que le nom dit : « Berne »
  // chercherait sinon « Berneuse » et « Bâle » tomberait sur « Balerna ».
  const alias = SWISS_ALIASES[fold(query)];
  if (alias) {
    const found = await locate(context, ville, alias);
    if (found) return found;
  }
  return locate(context, ville, query);
}

/** Arrêt le plus probable de la ville pour ce que dit la personne. */
async function locate(
  context: CollectContext,
  ville: string,
  query: string,
): Promise<Station | null> {
  const params = new URLSearchParams({
    // Sans ville, la recherche porte sur toute la Suisse : c'est l'API qui classe les résultats.
    query: ville ? `${ville} ${query}`.trim() : query,
    type: 'station',
    limit: '20',
  });
  const response = await context.http.fetch({
    url: `${locationsUrl}?${params.toString()}`,
    method: 'GET',
    signal: context.signal,
    timeoutMs: 8000,
    maxBytes: 128 * 1024,
  });
  if (response.status !== 200) fail(response);
  const payload = payloadOf(response);
  if (!validateLocations(payload) || !Array.isArray(payload.stations)) return null;
  const all = payload.stations
    .map((entry) => ({ id: text(entry.id, 40) || null, name: text(entry.name, 80) }))
    .filter((entry) => entry.name.length > 0);
  if (all.length === 0) return null;
  // Les arrêts d'une ville s'écrivent « Ville, Lieu » : le débarcadère « Lausanne-Ouchy (lac) »
  // n'a pas de virgule et reste dehors quand la ville en fournit.
  const cityPrefix = ville ? `${ville},`.toLowerCase() : '';
  const city = cityPrefix
    ? all.filter((entry) => entry.name.toLowerCase().startsWith(cityPrefix))
    : [];
  const nearby = ville ? all.filter((entry) => fold(entry.name).startsWith(fold(ville))) : [];
  const candidates = city.length > 0 ? city : nearby.length > 0 ? nearby : all;
  const wanted = fold(query);
  const suffix = (name: string) => {
    const comma = name.indexOf(',');
    return fold(comma >= 0 ? name.slice(comma + 1) : name);
  };
  // La demande peut être donnée avec sa ville (« Sion, gare ») ou sans (« Chailly »).
  // Un nom entier passe avant un début de mot, qui passe avant un simple préfixe :
  // « Berne » ne doit pas attraper « Berneuse », et « Ouchy-Olympique » devance « Croix d'Ouchy ».
  const rankOf = (haystack: string, needle: string): number => {
    if (!needle) return 9;
    const words = haystack.split(' ');
    const wantedWords = needle.split(' ');
    return haystack === needle
      ? 0
      : haystack.startsWith(needle)
        ? 1
        : words.includes(needle) || wantedWords.every((word) => words.includes(word))
          ? 2
          : words.some((word) => word.startsWith(needle))
            ? 3
            : haystack.includes(needle)
              ? 4
              : 9;
  };
  const scored = candidates
    .map((entry, index) => {
      const rank = Math.min(rankOf(fold(entry.name), wanted), rankOf(suffix(entry.name), wanted));
      return { entry, rank, index };
    })
    .filter((item) => item.rank < 9);
  if (scored.length === 0) return null;
  // À pertinence égale, l'ordre de l'API tranche : c'est son classement, pas une longueur de nom.
  scored.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return scored[0]?.entry ?? null;
}

/**
 * Les deux bouts d'un trajet dans la question : « Chailly > Ouchy », « Bel-Air → gare »,
 * « Chailly vers Ouchy », « Bel-Air à la gare ». Sans séparateur, la question ne décrit
 * qu'une destination.
 */
function bothEnds(query: string): { from: string; to: string } | null {
  const match = /^(.*?)\s*(?:>|→|->|\svers\s|\sà\s)\s*(.+)$/iu.exec(query.trim());
  if (!match) return null;
  const from = text(match[1], 80);
  const to = text(match[2], 80);
  return from && to ? { from, to } : null;
}

/** Itinéraires proposés entre deux arrêts, du plus proche au plus tardif. */
async function journeysOf(context: CollectContext, from: Station, to: Station): Promise<Trajet[]> {
  const params = new URLSearchParams({
    from: from.id ?? from.name,
    to: to.id ?? to.name,
    limit: '3',
  });
  const response = await context.http.fetch({
    url: `${connectionsUrl}?${params.toString()}`,
    method: 'GET',
    signal: context.signal,
    timeoutMs: 10_000,
    maxBytes: 512 * 1024,
    cacheMs: 30_000,
  });
  if (response.status !== 200) fail(response);
  const payload = payloadOf(response);
  if (!validateConnections(payload) || !Array.isArray(payload.connections))
    throw new AddonCollectError('malformed', 'Réponse sans itinéraire.');
  const trajets: Trajet[] = [];
  for (const connection of payload.connections) {
    const depart = normalizeIso(connection.from?.departure);
    const arrive = normalizeIso(connection.to?.arrival);
    if (!depart || !arrive) continue;
    const products = Array.isArray(connection.products)
      ? connection.products
          .map((product) => text(product, 24))
          .filter((product) => product.length > 0)
          .slice(0, 4)
      : [];
    const etapes: Etape[] = [];
    for (const section of connection.sections ?? []) {
      const journey = section?.journey;
      const walk = section?.walk;
      // Un tronçon à pied est une information : sans lui, l'heure du bus qui suit paraît
      // sortir de nulle part, et l'on ne comprend pas d'où viennent les minutes manquantes.
      if (!journey && !walk) continue;
      const departure = section?.departure;
      const arrival = section?.arrival;
      const etapeDepart = normalizeIso(departure?.departure);
      const etapeArrive = normalizeIso(arrival?.arrival);
      const depuis = text(departure?.station?.name, 80);
      const vers = text(arrival?.station?.name, 80);
      if (!etapeDepart || !etapeArrive || !depuis || !vers) continue;
      const marche = Math.max(1, Math.round(Number(walk?.duration) / 60));
      etapes.push({
        ligne: journey
          ? lineName(
              text(journey.category, 12),
              text(journey.number, 12),
              text(journey.name, 20),
            ).slice(0, 40)
          : `À pied · ${marche} min`,
        depuis,
        vers,
        depart: etapeDepart,
        arrive: etapeArrive,
        voie: text(departure?.platform, 20) || null,
      });
      if (etapes.length >= 8) break;
    }
    trajets.push({
      depart,
      arrive,
      dureeMin: durationMinutes(connection.duration),
      correspondances: Math.min(9, Math.max(0, Math.round(Number(connection.transfers) || 0))),
      lignes: products,
      etapes,
    });
  }
  return trajets;
}

const addon: AddonDefinition<ArretsConfig, ArretsData> = {
  id: 'arrets',
  apiVersion: 1,
  version: '1.2.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'transport.opendata.ch',
  display: {
    name: 'Arrêts et itinéraires',
    description:
      'Les lignes qui desservent un arrêt de la ville, et le trajet entre deux lieux de la ville.',
    icon: 'bus',
    group: 'daily',
    keywords: ['arrêt', 'arrêts', 'bus', 'tram', 'correspondance', 'ligne', 'itinéraire', 'trajet'],
    example: { label: 'Arrêts de Lausanne', ref: 'lausanne' },
    spoken: { head: 'les arrêts', repeats: ['arrets', 'arret'] },
  },
  configVersion: 1,
  configSchema,
  configDefaults: {
    ville: 'Lausanne',
    arret: 'Lausanne, Chailly-Village',
    limite: 6,
  },
  dataVersion: 3,
  dataSchema,
  freshMs: 45_000,
  tools: [
    {
      name: 'read',
      description:
        'Lire l’arrêt habituel et afficher ses lignes avec le prochain départ de chacune. ' +
        'Utiliser pour « mon bus », « le prochain bus », « quels bus passent à mon arrêt ? ».',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
    },
    {
      name: 'ask',
      description:
        'Chercher un arrêt par son nom dans la ville configurée et afficher toutes les lignes ' +
        'qui le desservent, leur direction et le prochain départ. Utiliser pour « quels bus ' +
        'passent à Bel-Air ? », « les lignes à Ouchy », « il y a quoi comme bus à Chailly ? ». ' +
        'query : le nom de l’arrêt ou du lieu tel qu’on le dit (« Bel-Air », « Chailly », ' +
        '« Riponne »), sans la ville et sans flèche.',
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
    {
      name: 'trajet',
      description:
        'Calculer un itinéraire en transports publics entre deux lieux de la ville et afficher ' +
        'la durée, les heures et les lignes à prendre. Utiliser pour « comment je vais à Ouchy ? », ' +
        '« c’est long d’aller à la gare ? », « je suis à Bel-Air, je vais au Flon ». query : les ' +
        'deux bouts, séparés par « > » : « Chailly > Ouchy », « Bel-Air > gare ». Pour partir de ' +
        'l’arrêt habituel, écrire « ici > Ouchy ». Ne jamais inventer une durée : si aucun trajet ' +
        'n’est trouvé, le dire.',
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
    // Ville vide : la recherche porte sur toute la Suisse, sans préfixe.
    const ville = text(context.config.ville, 40);
    const portee = ville || 'Suisse';
    const ou = ville ? `à ${ville}` : 'en Suisse';
    const limite = Math.min(12, Math.max(3, Math.round(context.config.limite)));
    const now = context.now();
    const habitual = text(context.config.arret, 80);
    if (!habitual)
      throw new AddonCollectError('config_invalid', 'Indiquez un arrêt à surveiller.', false);

    if (context.query === undefined) {
      // Lecture ordinaire : l'arrêt habituel, sans recherche.
      const board = await departuresOf(context, { id: null, name: habitual }, now);
      const lignes = groupLines(board.departures, limite);
      return {
        data: { kind: 'stop', arret: board.name, ville: portee, lignes },
        empty: lignes.length === 0,
        source: { provider: 'opendata-ch', sourceId: board.name },
      };
    }

    const query = context.query.trim();
    if (!query)
      throw new AddonCollectError('invalid_params', 'Précisez un arrêt ou un trajet.', false);

    const ends = bothEnds(query);
    if (ends) {
      // « ici > Ouchy » : la personne part de l'arrêt habituel sans avoir à le nommer.
      const fromHome = ['ici', 'moi', 'maison', 'domicile'].includes(fold(ends.from));
      // Un bout hors de la ville de la source reste cherchable : « gare > Renens » depuis
      // Lausanne doit trouver Renens, qui n'est pas dans Lausanne.
      const anywhere = async (name: string) =>
        (await findStop(context, ville, name)) ??
        (ville ? await findStop(context, '', name) : null);
      const from: Station | null = fromHome
        ? { id: null, name: habitual }
        : await anywhere(ends.from);
      if (!from)
        throw new AddonCollectError(
          'not_found',
          `Aucun arrêt « ${ends.from} » trouvé ${ou}.`,
          false,
        );
      const to = await anywhere(ends.to);
      if (!to)
        throw new AddonCollectError('not_found', `Aucun arrêt « ${ends.to} » trouvé ${ou}.`, false);
      const trajets = await journeysOf(context, from, to);
      if (trajets.length === 0)
        throw new AddonCollectError(
          'not_found',
          `Aucun trajet entre ${from.name} et ${to.name}.`,
          false,
        );
      return {
        data: { kind: 'trajet', depuis: from.name, vers: to.name, trajets },
        source: { provider: 'opendata-ch', sourceId: `${from.name} > ${to.name}`.slice(0, 128) },
      };
    }

    // Un seul lieu : ou bien l'arrêt demandé, ou bien la destination depuis l'arrêt habituel.
    const stop = await findStop(context, ville, query);
    if (!stop)
      throw new AddonCollectError('not_found', `Aucun arrêt « ${query} » trouvé ${ou}.`, false);
    const board = await departuresOf(context, stop, now);
    const lignes = groupLines(board.departures, limite);
    return {
      data: { kind: 'stop', arret: board.name, ville: portee, lignes },
      empty: lignes.length === 0,
      source: { provider: 'opendata-ch', sourceId: board.name },
    };
  },
  present(snapshot, context) {
    const data = snapshot.data;
    if (!data) throw new Error('Aucun arrêt à présenter.');
    const stale = snapshot.status === 'stale';

    if (data.kind === 'trajet') {
      const premier = data.trajets[0];
      if (!premier) throw new Error('Aucun itinéraire à présenter.');
      // La carte montre le trajet lui-même : quelle ligne, de quel arrêt à quel arrêt, et où
      // l'on change. Les propositions suivantes tiennent en une ligne chacune.
      const detail = premier.etapes.length >= 1;
      // Cinq lignes au plus sur une carte : quand un trajet en compte davantage, les marches
      // cèdent la place aux lignes, qui sont l'essentiel de la réponse.
      const marches = (etape: Etape) => etape.ligne.startsWith('À pied');
      const montrer =
        premier.etapes.length <= 5
          ? premier.etapes
          : premier.etapes.filter((etape) => !marches(etape)).slice(0, 5);
      const items: { label: string; value: string }[] = detail
        ? montrer.map((etape) => ({
            label: `${etape.ligne} · ${clock(etape.depart, context.timeZone)}`.slice(0, 80),
            value: `${etape.depuis} → ${etape.vers}`.slice(0, 160),
          }))
        : data.trajets.slice(0, 3).map((trajet) => ({
            label: `${clock(trajet.depart, context.timeZone)} → ${clock(
              trajet.arrive,
              context.timeZone,
            )}`,
            value: [
              `${trajet.dureeMin} min`,
              trajet.correspondances === 0
                ? 'direct'
                : `${trajet.correspondances} correspondance${trajet.correspondances > 1 ? 's' : ''}`,
              trajet.lignes.join(', '),
            ]
              .filter(Boolean)
              .join(' · ')
              .slice(0, 160),
          }));
      // La proposition suivante, en une ligne : elle n'apparaît que si la place le permet.
      const suivant = data.trajets[1];
      if (detail && suivant && items.length < 5) {
        items.push({
          label: `Suivant · ${clock(suivant.depart, context.timeZone)}`,
          value: `${suivant.dureeMin} min · ${clock(suivant.depart, context.timeZone)} → ${clock(
            suivant.arrive,
            context.timeZone,
          )}${suivant.correspondances === 0 ? '' : ` · ${suivant.correspondances} corr.`}`.slice(
            0,
            160,
          ),
        });
      }
      // Chaque changement : l'arrêt où l'on descend et le temps d'attente avant la suite.
      const changements: string[] = [];
      if (detail) {
        for (let index = 1; index < premier.etapes.length; index++) {
          const before = premier.etapes[index - 1]!;
          const etape = premier.etapes[index]!;
          // Après une marche, on ne change pas de ligne : on monte.
          if (before.ligne.startsWith('À pied') || etape.ligne.startsWith('À pied')) continue;
          const attente = Math.round(
            (new Date(etape.depart).getTime() - new Date(before.arrive).getTime()) / 60_000,
          );
          changements.push(`${etape.depuis}${attente > 0 ? ` (${attente} min)` : ''}`);
        }
      }
      const lignes = premier.lignes.length > 0 ? ` Lignes : ${premier.lignes.join(', ')}.` : '';
      const correspondances =
        premier.correspondances === 0
          ? ', sans correspondance'
          : `, ${premier.correspondances} correspondance${premier.correspondances > 1 ? 's' : ''}`;
      const ou = changements.length > 0 ? ` Changement à ${changements.join(', puis ')}.` : '';
      return {
        title: 'Itinéraire',
        primaryValue: `${premier.dureeMin} min`,
        subtitle: `${data.depuis} → ${data.vers}`.slice(0, 120),
        description: stale ? 'Dernier relevé connu, à vérifier.' : null,
        items,
        summary: firstSentence(
          `De ${data.depuis} à ${data.vers} : départ à ${clock(
            premier.depart,
            context.timeZone,
          )}, arrivée à ${clock(premier.arrive, context.timeZone)}, ${premier.dureeMin} minutes${correspondances}.${ou}${lignes}`,
          500,
        ),
        sources: ['transport.opendata.ch'],
      };
    }

    const nombre = data.lignes.length;
    if (nombre === 0) throw new Error('Aucun départ à présenter.');
    const items = data.lignes.slice(0, 5).map((ligne) => ({
      label: ligne.ligne,
      value: `→ ${ligne.direction} · ${clock(ligne.depart, context.timeZone)}${
        ligne.retardMin > 0 ? ` (+${ligne.retardMin})` : ''
      }`.slice(0, 160),
    }));
    const premieres = data.lignes
      .slice(0, 3)
      .map(
        (ligne) =>
          `${ligne.ligne} vers ${ligne.direction} à ${clock(ligne.depart, context.timeZone)}`,
      );
    return {
      title: 'Arrêts',
      primaryValue: `${nombre} ligne${nombre > 1 ? 's' : ''}`,
      subtitle: data.arret.slice(0, 120),
      description: stale ? 'Dernier relevé connu, à vérifier.' : null,
      items,
      summary: `${stale ? 'Dernier relevé connu à' : 'À'} ${data.arret} : ${premieres.join(', ')}${
        nombre > 3 ? `, et ${nombre - 3} autre${nombre - 3 > 1 ? 's' : ''}` : ''
      }.`,
      sources: ['transport.opendata.ch'],
    };
  },
};

export default addon;
