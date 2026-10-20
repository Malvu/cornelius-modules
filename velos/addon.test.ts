import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AddonRepository,
  AddonRuntime,
  openDatabase,
  validateAddonDefinition,
} from '#cornelius/testing';
import type { AddonHttpClient, AddonHttpRequest } from '#cornelius/addons';
import { validators } from '#cornelius/validation';
import addon from './index.js';

/**
 * Réponses réelles du 20/10/2026, réduites à quelques stations : Vélib’ (GBFS 2.x, vélos
 * électriques à part), Le Vélo TBM (3.0, types de vélos), LE vélo STAR (2.x, une station
 * fermée), et un extrait du catalogue des réseaux.
 */
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const systems: Record<string, string> = {
  'smovengo.cloud': 'velib',
  'mecatran.com': 'tbm',
  'opendatasoft.com': 'star',
};

const velib = 'https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/gbfs.json';
const tbm =
  'https://bdx.mecatran.com/utw/ws/gbfs/bordeaux/v3/gbfs.json?apiKey=opendata-bordeaux-metropole-flux-gtfs-rt';
const star = 'https://eu.ftp.opendatasoft.com/star/gbfs/gbfs.json';

function client(
  calls: AddonHttpRequest[],
  override?: (url: string) => string | null,
): AddonHttpClient {
  return {
    async fetch(request) {
      calls.push(request);
      const url = request.url;
      const body =
        override?.(url) ??
        (url.includes('raw.githubusercontent.com')
          ? fixture('systems.csv')
          : (() => {
              const prefix = Object.entries(systems).find(([host]) => url.includes(host))?.[1];
              const feed = /\/([a-z_]+)\.json/u.exec(new URL(url).pathname)?.[1];
              return prefix && feed ? fixture(`${prefix}-${feed}.json`) : null;
            })());
      const status = body === null ? 404 : 200;
      return {
        status,
        headers: {},
        text: () => body ?? '',
        json: () => JSON.parse(body ?? '') as unknown,
      };
    },
  };
}

function setup(
  t: { after(fn: () => void): void },
  config: Record<string, unknown> = {},
  override?: (url: string) => string | null,
) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const instances = new AddonRepository(db);
  const instance = instances.createInstance({
    addonId: addon.id,
    profileId: null,
    ref: 'station',
    label: 'Vélos du coin',
    config: { ...addon.configDefaults, ...config },
    configVersion: addon.configVersion,
  });
  const calls: AddonHttpRequest[] = [];
  const runtime = new AddonRuntime({
    addons: [addon],
    instances,
    now: () => Date.parse('2026-10-20T13:15:00Z'),
    http: client(calls, override),
  });
  return {
    runtime,
    instance,
    calls,
    read: () => runtime.read(addon.id, null, 'station', new AbortController().signal),
  };
}

const searchContext = (calls: AddonHttpRequest[]) => ({
  http: client(calls),
  signal: new AbortController().signal,
  secret: () => undefined,
});

test('définition v1, configuration, snapshot, carte et résultat outil conformes', async (t) => {
  const f = setup(t);
  assert.equal(validateAddonDefinition(addon), null);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  for (const patch of [{ systemUrl: 'http://exemple.fr/gbfs.json' }, { stationId: 'a b' }])
    assert.equal(
      f.runtime.validateConfig(addon.id, { ...addon.configDefaults, ...patch }).ok,
      false,
      JSON.stringify(patch),
    );
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(validators.moduleSnapshot(result.snapshot), true);
  assert.equal(validators.moduleCard(result.card), true);
  assert.equal(validators.ambientPresentation(f.runtime.ambientDisplay(f.instance).content), true);
  assert.equal(validators.toolResult(f.runtime.toolResult(result)), true);
});

test('Vélib’ (GBFS 2.x) : vélos mécaniques et électriques, places libres', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.title, 'Vélos · Vélib’ Métropole');
  assert.equal(result.card.primaryValue, '20 vélos');
  assert.equal(result.card.subtitle, 'Benjamin Godard - Victor Hugo');
  assert.deepEqual(result.card.items, [
    { label: 'Mécaniques', value: '16' },
    { label: 'Électriques', value: '4' },
    { label: 'Places libres', value: '14' },
  ]);
  assert.equal(
    result.presentation.summary,
    'Station Benjamin Godard - Victor Hugo : 20 vélos, dont 4 électriques et 14 places libres.',
  );
  // Seul l'état est lu à chaque collecte : pas les 276 Ko des informations de stations.
  assert.deepEqual(
    f.calls.map((call) => new URL(call.url).pathname.split('/').at(-1)),
    ['gbfs.json', 'station_status.json'],
  );
});

test('Le Vélo TBM (GBFS 3.0) : électriques comptés par le type de propulsion', async (t) => {
  const f = setup(t, {
    systemUrl: tbm,
    systemLabel: 'Le Vélo par TBM',
    stationId: '1',
    stationLabel: 'Meriadeck',
  });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.primaryValue, '9 vélos');
  assert.deepEqual(result.card.items, [
    { label: 'Mécaniques', value: '4' },
    { label: 'Électriques', value: '5' },
    { label: 'Places libres', value: '33' },
  ]);
  assert.equal(result.snapshot.data!.reported, '2026-10-20T13:10:43.000Z');
});

test('LE vélo STAR : station fermée, puis station sans type de vélo connu', async (t) => {
  const f = setup(t, {
    systemUrl: star,
    systemLabel: 'LE vélo STAR',
    stationId: '5501',
    stationLabel: 'République',
  });
  const closed = await f.read();
  assert.equal(closed.ok, true);
  if (!closed.ok) return;
  assert.equal(closed.card.primaryValue, 'Station fermée');
  assert.deepEqual(closed.card.items, []);
  assert.equal(closed.presentation.summary, 'La station République est fermée pour le moment.');
  assert.equal(f.runtime.ambientDisplay(f.instance).content?.value, 'Fermée');

  const g = setup(t, {
    systemUrl: star,
    systemLabel: 'LE vélo STAR',
    stationId: '5502',
    stationLabel: 'Mairie - Opéra',
  });
  const open = await g.read();
  assert.equal(open.ok, true);
  if (!open.ok) return;
  assert.deepEqual(open.card.items, [{ label: 'Places libres', value: '21' }]);
  assert.equal(open.presentation.summary, 'Station Mairie - Opéra : 2 vélos et 21 places libres.');
});

test('station vide ou pleine : « aucun vélo », « aucune place libre »', async (t) => {
  const status = JSON.parse(fixture('velib-station_status.json'));
  status.data.stations[0] = {
    ...status.data.stations[0],
    num_bikes_available: 0,
    num_bikes_available_types: [{ mechanical: 0 }, { ebike: 0 }],
    num_docks_available: 0,
  };
  const f = setup(t, {}, (url) => (url.includes('station_status') ? JSON.stringify(status) : null));
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.primaryValue, 'Aucun vélo');
  assert.equal(
    result.presentation.summary,
    'Station Benjamin Godard - Victor Hugo : aucun vélo et aucune place libre.',
  );
});

test('station disparue du réseau, réseau sans état des stations', async (t) => {
  const gone = await setup(t, { stationId: '999' }).read();
  assert.equal(gone.ok, false);
  if (!gone.ok) assert.equal(gone.error.code, 'not_found');

  const discovery = JSON.stringify({
    version: '3.0',
    data: { feeds: [{ name: 'vehicle_status', url: 'https://x.fr/v.json' }] },
  });
  const free = await setup(t, {}, (url) => (url.endsWith('gbfs.json') ? discovery : null)).read();
  assert.equal(free.ok, false);
  if (!free.ok) assert.equal(free.error.message, 'Ce réseau ne publie pas l’état de ses stations.');
});

test('recherche du réseau : par ville, sans autopartage ni trottinettes, hors de France proche', async () => {
  const calls: AddonHttpRequest[] = [];
  const context = searchContext(calls);
  const rennes = await addon.search!.find({ kind: 'system', query: 'rennes', values: {} }, context);
  assert.deepEqual(rennes, [
    {
      id: 'https://eu.ftp.opendatasoft.com/star/gbfs/gbfs.json',
      label: 'LE vélo STAR',
      detail: 'Rennes',
    },
  ]);
  const bordeaux = await addon.search!.find(
    { kind: 'system', query: 'Bordeaux', values: {} },
    context,
  );
  assert.deepEqual(
    bordeaux.map((r) => r.label),
    ['Le Vélo par TBM'],
  );
  const velib = await addon.search!.find({ kind: 'system', query: 'velib', values: {} }, context);
  assert.deepEqual(
    velib.map((r) => r.label),
    ["Vélib' Metropole", 'Vélibéo'],
  );
  const brussels = await addon.search!.find(
    { kind: 'system', query: 'villo', values: {} },
    context,
  );
  assert.equal(brussels.length, 1);
});

test('recherche de la station : par son nom, sans accents, avec adresse et capacité', async () => {
  const calls: AddonHttpRequest[] = [];
  const context = searchContext(calls);
  const found = await addon.search!.find(
    { kind: 'station', query: 'hotel de region', values: { systemUrl: tbm } },
    context,
  );
  assert.deepEqual(found, [
    {
      id: '2',
      label: 'Saint-Bruno - Hôtel de Région',
      detail: 'RUE FRANÇOIS DE SOURDIS (CIMETIÈRE DE LA CHARTREUSE) , BORDEAUX · 20 places',
    },
  ]);
  assert.deepEqual(
    await addon.search!.find(
      { kind: 'station', query: 'godard', values: { systemUrl: velib } },
      context,
    ),
    [{ id: '213688169', label: 'Benjamin Godard - Victor Hugo', detail: '35 places' }],
  );
  assert.deepEqual(
    await addon.search!.find({ kind: 'station', query: 'opéra', values: {} }, context),
    [],
  );
});
