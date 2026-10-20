/** Prix des carburants d'une station, d'après le flux instantané du ministère de l'Économie. */
import { AddonCollectError, type AddonDefinition, type AddonHttpClient } from '#cornelius/addons';
import { compile } from '#cornelius/validation';
import { dateIn } from '../_lib/temps.js';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type Fuel = 'gazole' | 'sp95' | 'sp98' | 'e10' | 'e85' | 'gplc';
type CarburantsConfig = { stationId: string; stationLabel: string; fuel: Fuel | null };
type Price = { fuel: Fuel; price: number; updated: string | null };
type CarburantsData = {
  address: string;
  city: string;
  prices: Price[];
  /** Carburant demandé à la voix (argument), pour dire s'il manque à cette station. */
  asked?: Fuel;
};

type Station = {
  id: number;
  adresse: string | null;
  ville: string | null;
  cp: string | null;
} & Record<string, unknown>;

const recordsUrl =
  'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';
const fuels: Fuel[] = ['gazole', 'e10', 'sp95', 'sp98', 'e85', 'gplc'];
const fields = ['id', 'adresse', 'ville', 'cp', ...fuels.flatMap((f) => [`${f}_prix`, `${f}_maj`])];

const names: Record<Fuel, { label: string; spoken: string }> = {
  gazole: { label: 'Gazole', spoken: 'gazole' },
  e10: { label: 'SP95-E10', spoken: 'sans-plomb E10' },
  sp95: { label: 'SP95', spoken: 'sans-plomb 95' },
  sp98: { label: 'SP98', spoken: 'sans-plomb 98' },
  e85: { label: 'E85', spoken: 'E85' },
  gplc: { label: 'GPL', spoken: 'GPL' },
};

const validateRecords = compile<{ results: Station[] }>({
  type: 'object',
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'integer' },
          adresse: { type: ['string', 'null'] },
          ville: { type: ['string', 'null'] },
          cp: { type: ['string', 'null'] },
        },
      },
    },
  },
});

const euro = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const shortDay = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
});
const dayMs = 86_400_000;

async function records(
  http: AddonHttpClient,
  where: string,
  limit: number,
  signal: AbortSignal | undefined,
): Promise<Station[]> {
  const query = new URLSearchParams({ select: fields.join(','), where, limit: String(limit) });
  const response = await http.fetch({
    url: `${recordsUrl}?${query}`,
    method: 'GET',
    signal,
    timeoutMs: 8000,
    maxBytes: 256 * 1024,
  });
  if (response.status === 429)
    throw new AddonCollectError(
      'quota',
      'Prix des carburants : trop de demandes, réessayer plus tard.',
      true,
    );
  if (response.status >= 500)
    throw new AddonCollectError('unavailable', 'Prix des carburants indisponibles.', true);
  if (response.status !== 200)
    throw new AddonCollectError(
      'upstream',
      `Prix des carburants : réponse HTTP ${response.status} inattendue.`,
    );
  let payload: unknown;
  try {
    payload = response.json();
  } catch {
    throw new AddonCollectError('malformed', 'Prix des carburants : réponse illisible.');
  }
  if (!validateRecords(payload))
    throw new AddonCollectError('malformed', 'Prix des carburants : réponse inattendue.');
  return payload.results;
}

/**
 * Le flux note ses heures « +00:00 » alors qu'elles sont à l'heure de Paris : seule la date
 * du relevé est gardée, lue telle quelle.
 */
function pricesOf(station: Station, preferred: Fuel | null): Price[] {
  const order = preferred ? [preferred, ...fuels.filter((fuel) => fuel !== preferred)] : fuels;
  const prices: Price[] = [];
  for (const fuel of order) {
    const price = station[`${fuel}_prix`];
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > 20) continue;
    const updated = station[`${fuel}_maj`];
    prices.push({
      fuel,
      price,
      updated:
        typeof updated === 'string' && /^\d{4}-\d{2}-\d{2}/u.test(updated)
          ? updated.slice(0, 10)
          : null,
    });
  }
  return prices;
}

function clean(text: string | null, fallback: string): string {
  const value = (text ?? '').replace(/\s+/gu, ' ').trim();
  return value || fallback;
}

/** « 2,338 € » à l'écran ; « 2 euros 34 » à l'oral, au centime près. */
function shown(price: number): string {
  return `${euro.format(price)} €`;
}
function spokenPrice(price: number): string {
  const cents = Math.round(price * 100);
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  if (euros === 0) return `${rest} centimes`;
  return rest === 0
    ? `${euros} euro${euros > 1 ? 's' : ''}`
    : `${euros} euro${euros > 1 ? 's' : ''} ${rest}`;
}

/** Ancienneté d'un relevé, comptée en jours du foyer. */
function age(updated: string | null, now: number, zone: string): string | null {
  if (!updated) return null;
  const today = dateIn(now, zone);
  const days = Math.round((Date.parse(today) - Date.parse(updated)) / dayMs);
  if (days <= 0) return 'aujourd’hui';
  if (days === 1) return 'hier';
  return `le ${shortDay.format(Date.parse(updated)).replace(/^1 /u, '1er ')}`;
}

const addon: AddonDefinition<CarburantsConfig, CarburantsData> = {
  id: 'carburants',
  apiVersion: 1,
  version: '1.1.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'Prix des carburants',
  display: {
    name: 'Prix des carburants',
    description: 'Les prix affichés dans une station-service, carburant principal d’abord.',
    icon: 'fuel',
    keywords: ['carburant', 'essence', 'gazole', 'diesel', 'station', 'prix', 'sp98', 'e10'],
    example: { label: 'Station de la maison', ref: 'station' },
    spoken: { head: 'les prix', repeats: ['station', 'carburant', 'carburants', 'prix'] },
  },
  configVersion: 1,
  configSchema,
  configDefaults: {
    stationId: '35743001',
    stationLabel: 'boulevard Giraudais, Pacé',
    fuel: 'gazole',
  },
  dataVersion: 1,
  dataSchema,
  freshMs: 30 * 60 * 1000,
  tools: [
    {
      name: 'read',
      description:
        'Lire les prix des carburants de la station configurée et afficher sa carte. Utiliser ' +
        'pour « combien coûte le gazole ? » ou « le prix de l’essence à la station ».',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
      arguments: {
        carburant: {
          type: 'string',
          enum: fuels,
          description:
            'Carburant demandé, annoncé en premier : gazole, e10 (SP95-E10), sp95, sp98, e85 ou gplc.',
        },
      },
    },
  ],
  search: {
    fields: [
      {
        kind: 'station',
        label: 'Station',
        target: 'stationId',
        labelTarget: 'stationLabel',
        placeholder: 'Commune ou code postal',
      },
    ],
    async find(input, context) {
      if (input.kind !== 'station') return [];
      const query = (input.query ?? '').replace(/["\\]/gu, '').trim();
      if (query.length < 2) return [];
      // Un code postal trouve exactement ; un nom de commune passe par la recherche floue.
      const where = /^\d{5}$/u.test(query) ? `cp="${query}"` : `search(ville, "${query}")`;
      const stations = await records(context.http, where, 20, context.signal);
      return stations.map((station) => {
        const prices = pricesOf(station, null).slice(0, 3);
        return {
          id: String(station.id),
          label: `${clean(station.adresse, 'Station')}, ${clean(station.ville, '')}`.replace(
            /, $/u,
            '',
          ),
          detail:
            [station.cp, ...prices.map((p) => `${names[p.fuel].label} ${shown(p.price)}`)]
              .filter(Boolean)
              .join(' · ') || undefined,
        };
      });
    },
  },
  async collect(context) {
    const { stationId } = context.config;
    // « Et le SP98 ? » : le carburant demandé passe devant celui des réglages.
    const asked = context.args?.carburant;
    const fuel = typeof asked === 'string' ? (asked as Fuel) : context.config.fuel;
    const [station] = await records(context.http, `id=${stationId}`, 1, context.signal);
    if (!station)
      throw new AddonCollectError('not_found', 'Station introuvable : la chercher à nouveau.');
    const prices = pricesOf(station, fuel);
    return {
      data: {
        address: clean(station.adresse, 'Station').slice(0, 160),
        city: clean(station.ville, 'Commune inconnue').slice(0, 80),
        prices,
        ...(typeof asked === 'string' ? { asked: asked as Fuel } : {}),
      },
      // Une station sans aucun prix publié répond, sans rien à dire.
      empty: prices.length === 0,
      source: { provider: 'prix-carburants.gouv.fr', sourceId: stationId },
    };
  },
  ambient: {
    present(snapshot) {
      const data = snapshot.data;
      const [main, ...others] = data?.prices ?? [];
      if (!data) throw new Error('Aucun prix à afficher.');
      if (!main)
        return {
          layout: 'metric',
          title: 'Carburants',
          value: 'Aucun prix',
          subtitle: data.city,
          items: [],
        };
      return {
        layout: 'metric',
        title: 'Carburants',
        value: `${names[main.fuel].label} ${shown(main.price)}`,
        subtitle: data.city,
        items: others
          .slice(0, 2)
          .map((p) => ({ label: names[p.fuel].label, value: shown(p.price) })),
      };
    },
  },
  present(snapshot, context) {
    const data = snapshot.data;
    const [main] = data?.prices ?? [];
    if (!data) throw new Error('Aucun prix à présenter.');
    // La station répond sans prix publié (fermée, en travaux) : on le dit, sans inventer.
    if (!main)
      return {
        title: `Carburants · ${data.city}`.slice(0, 80),
        primaryValue: 'Aucun prix',
        subtitle: data.address.slice(0, 120),
        description: null,
        items: [],
        summary:
          `La station de ${data.city}, ${data.address}, ne publie aucun prix pour le moment.`.slice(
            0,
            500,
          ),
        sources: ['carburants'],
      };
    const now = context.now();
    const stale = snapshot.status === 'stale';
    const old = data.prices.filter(
      (p) => p.updated && age(p.updated, now, context.timeZone)?.startsWith('le '),
    );
    return {
      title: `Carburants · ${data.city}`.slice(0, 80),
      primaryValue: `${names[main.fuel].label} ${shown(main.price)}`,
      subtitle: data.address.slice(0, 120),
      description: stale
        ? 'Derniers prix connus : le service ne répond pas.'
        : old.length
          ? `Prix plus anciens que d’hier : ${old.map((p) => `${names[p.fuel].label} ${age(p.updated, now, context.timeZone)}`).join(', ')}.`.slice(
              0,
              500,
            )
          : null,
      items: data.prices.slice(0, 5).map((p) => ({
        label: names[p.fuel].label,
        value: [shown(p.price), age(p.updated, now, context.timeZone)].filter(Boolean).join(' · '),
      })),
      summary:
        (stale ? 'Derniers prix connus, à vérifier. ' : '') +
        (data.asked && !data.prices.some((p) => p.fuel === data.asked)
          ? `Pas de ${names[data.asked].spoken} à cette station. `
          : '') +
        `À ${data.city}, ${data.address} : ` +
        data.prices
          .slice(0, 3)
          .map((p) => `${names[p.fuel].spoken} à ${spokenPrice(p.price)}`)
          .join(', ') +
        '.',
      sources: ['carburants'],
    };
  },
};

export default addon;
