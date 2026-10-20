import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon from './index.js';
// Réponses réelles du flux instantané (données publiques), le 20/10/2026.
import station from './fixtures/station-35743001.json' with { type: 'json' };
import search from './fixtures/recherche-35740.json' with { type: 'json' };

const setup = (
  t: { after(fn: () => void): void },
  config: Record<string, unknown> = {},
  at = '2026-10-20T10:00:00Z',
) =>
  createTestModule(t, addon, {
    config,
    at,
    routes: { 'where=id%3D35743001': station, 'where=cp': search, 'where=search': search },
  });

const decoded = (url: string | undefined) => decodeURIComponent((url ?? '').replace(/\+/gu, ' '));

test('définition, réglages, contrat et requête de la station', async (t) => {
  const f = setup(t);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(
    f.runtime.validateConfig(addon.id, { ...addon.configDefaults, fuel: null }).ok,
    true,
    '« Tous » est un choix',
  );
  for (const patch of [{ stationId: '1 or 1=1' }, { fuel: 'diesel' }, { stationLabel: '' }])
    assert.equal(
      f.runtime.validateConfig(addon.id, { ...addon.configDefaults, ...patch }).ok,
      false,
      JSON.stringify(patch),
    );
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  assert.match(decoded(f.calls[0]?.url), /where=id=35743001&limit=1$/u);
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

test('un autre carburant principal, réglé ou demandé à la voix, passe en tête', async (t) => {
  const f = setup(t, { fuel: 'e85' });
  const result = await f.read();
  assert.equal(result.ok && result.card.primaryValue, 'E85 0,920 €');
  // « Et le GPL ? » : argument typé, lecture à la demande.
  const asked = await setup(t).invoke('read', { carburant: 'gplc' });
  assert.equal(asked.outcome.ok && asked.outcome.card.primaryValue, 'GPL 0,936 €');
  assert.match(asked.tool.summary, /: GPL à 94 centimes/u);
  // Absent de cette station : dit en tête, puis les prix qui existent.
  const missing = await setup(t).invoke('read', { carburant: 'sp95' });
  assert.match(missing.tool.summary, /^Pas de sans-plomb 95 à cette station. À Pacé/u);
  const unknown = await setup(t).invoke('read', { carburant: 'diesel' });
  assert.equal(unknown.tool.error?.code, 'invalid_params');
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
  f.route({ 'where=id': { total_count: 0, results: [] } });
  const gone = await f.read();
  assert.equal(gone.ok, false);
  if (!gone.ok) assert.equal(gone.error.code, 'not_found');

  // Aucun prix publié : rien à signaler, et le module le dit.
  const g = setup(t);
  const bare = {
    ...station.results[0]!,
    gazole_prix: null,
    e10_prix: null,
    e85_prix: null,
    gplc_prix: null,
  };
  g.route({ 'where=id': { results: [bare] } });
  const empty = await g.invoke();
  assert.equal(empty.tool.status, 'empty');
  assert.equal(
    empty.tool.summary,
    'La station de Pacé, boulevard Giraudais, ne publie aucun prix pour le moment.',
  );
  assert.equal(g.ambient().content?.value, 'Aucun prix');

  const h = setup(t);
  h.route({ 'where=id': { status: 503 } });
  const down = await h.read();
  assert.equal(down.ok, false);
  if (!down.ok) assert.equal(down.error.code, 'unavailable');
});

test('recherche assistée : code postal exact, nom de commune, guillemets retirés', async (t) => {
  const f = setup(t);
  const signal = new AbortController().signal;
  const results = await f.runtime.search(addon.id, { kind: 'station', query: '35740' }, signal);
  assert.match(decoded(f.calls[0]?.url), /where=cp="35740"/u);
  assert.equal(results.length, search.results.length);
  assert.deepEqual(
    results.find((r) => r.id === '35743001'),
    {
      id: '35743001',
      label: 'boulevard Giraudais, Pacé',
      detail: '35740 · Gazole 2,338 € · SP95-E10 2,144 € · E85 0,920 €',
    },
  );
  await f.runtime.search(addon.id, { kind: 'station', query: 'Pacé" or "1' }, signal);
  assert.match(decoded(f.calls[1]?.url), /where=search\(ville, "Pacé or 1"\)/u);
  assert.deepEqual(await f.runtime.search(addon.id, { kind: 'station', query: 'P' }, signal), []);
  assert.equal(f.calls.length, 2);
});
