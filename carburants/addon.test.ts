import assert from 'node:assert/strict';
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
// Réponses réelles du flux instantané (données publiques), le 20/10/2026.
import station from './fixtures/station-35743001.json' with { type: 'json' };
import search from './fixtures/recherche-35740.json' with { type: 'json' };

type Reply = { status: number; body: string };

function client(reply: () => Reply, calls: AddonHttpRequest[]): AddonHttpClient {
  return {
    async fetch(request) {
      calls.push(request);
      const { status, body } = reply();
      return { status, headers: {}, text: () => body, json: () => JSON.parse(body) as unknown };
    },
  };
}

function setup(
  t: { after(fn: () => void): void },
  config: Record<string, unknown> = {},
  at = '2026-10-20T10:00:00Z',
) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const instances = new AddonRepository(db);
  const instance = instances.createInstance({
    addonId: addon.id,
    profileId: null,
    ref: 'station',
    label: 'Station de Pacé',
    config: { ...addon.configDefaults, ...config },
    configVersion: addon.configVersion,
  });
  let reply: Reply = { status: 200, body: JSON.stringify(station) };
  const calls: AddonHttpRequest[] = [];
  const runtime = new AddonRuntime({
    addons: [addon],
    instances,
    now: () => Date.parse(at),
    http: client(() => reply, calls),
  });
  return {
    runtime,
    instance,
    calls,
    read: () => runtime.read(addon.id, null, 'station', new AbortController().signal),
    reply: (next: Reply) => {
      reply = next;
    },
  };
}

const decoded = (request: AddonHttpRequest | undefined) =>
  decodeURIComponent((request?.url ?? '').replace(/\+/gu, ' '));

test('définition v1, configuration, snapshot, carte et résultat outil conformes', async (t) => {
  const f = setup(t);
  assert.equal(validateAddonDefinition(addon), null);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  for (const patch of [{ stationId: '1 or 1=1' }, { fuel: 'diesel' }, { stationLabel: '' }])
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
  assert.match(decoded(f.calls[0]), /where=id=35743001&limit=1$/u);
});

test('les prix de la station, carburant principal d’abord, au centime près à l’oral', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.title, 'Carburants · Pacé');
  assert.equal(result.card.primaryValue, 'Gazole 2,338 €');
  assert.equal(result.card.subtitle, 'boulevard Giraudais');
  assert.deepEqual(result.card.items, [
    { label: 'Gazole', value: '2,338 € · aujourd’hui' },
    { label: 'SP95-E10', value: '2,144 € · hier' },
    { label: 'E85', value: '0,920 € · hier' },
    { label: 'GPL', value: '0,936 € · hier' },
  ]);
  assert.equal(result.card.description, null);
  assert.equal(
    result.presentation.summary,
    'À Pacé, boulevard Giraudais : gazole à 2 euros 34, sans-plomb E10 à 2 euros 14, ' +
      'E85 à 92 centimes.',
  );
});

test('un autre carburant principal passe en tête', async (t) => {
  const f = setup(t, { fuel: 'e85' });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.card.primaryValue, 'E85 0,920 €');
});

test('des prix anciens sont signalés à leur date', async (t) => {
  const f = setup(t, {}, '2026-10-25T10:00:00Z');
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.items[0]?.value, '2,338 € · le 20 octobre');
  assert.match(
    result.card.description ?? '',
    /^Prix plus anciens que d’hier : Gazole le 20 octobre/u,
  );
});

test('station disparue, sans aucun prix, ou service en panne', async (t) => {
  const f = setup(t);
  f.reply({ status: 200, body: '{"total_count": 0, "results": []}' });
  const gone = await f.read();
  assert.equal(gone.ok, false);
  if (!gone.ok) assert.equal(gone.error.code, 'not_found');

  const g = setup(t);
  const bare = {
    ...station.results[0]!,
    gazole_prix: null,
    e10_prix: null,
    e85_prix: null,
    gplc_prix: null,
  };
  g.reply({ status: 200, body: JSON.stringify({ results: [bare] }) });
  const empty = await g.read();
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.status, 'empty');

  const h = setup(t);
  h.reply({ status: 503, body: '' });
  const down = await h.read();
  assert.equal(down.ok, false);
  if (!down.ok) assert.equal(down.error.code, 'unavailable');
});

test('recherche assistée : code postal exact, nom de commune, guillemets retirés', async () => {
  const calls: AddonHttpRequest[] = [];
  const context = {
    http: client(() => ({ status: 200, body: JSON.stringify(search) }), calls),
    signal: new AbortController().signal,
    secret: () => undefined,
  };
  const results = await addon.search!.find(
    { kind: 'station', query: '35740', values: {} },
    context,
  );
  assert.match(decoded(calls[0]), /where=cp="35740"/u);
  assert.equal(results.length, search.results.length);
  assert.deepEqual(
    results.find((r) => r.id === '35743001'),
    {
      id: '35743001',
      label: 'boulevard Giraudais, Pacé',
      detail: '35740 · Gazole 2,338 € · SP95-E10 2,144 € · E85 0,920 €',
    },
  );
  await addon.search!.find({ kind: 'station', query: 'Pacé" or "1', values: {} }, context);
  assert.match(decoded(calls[1]), /where=search\(ville, "Pacé or 1"\)/u);
  assert.deepEqual(
    await addon.search!.find({ kind: 'station', query: 'P', values: {} }, context),
    [],
  );
  assert.equal(calls.length, 2);
});
