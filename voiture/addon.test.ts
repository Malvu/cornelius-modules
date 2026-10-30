import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule, validateAddonDefinition, type TestReply } from '#cornelius/testing';
import addon from './index.js';
import search from './fixtures/search.json' with { type: 'json' };
import route from './fixtures/route.json' with { type: 'json' };

const setup = (
  t: { after(fn: () => void): void },
  options: { config?: Record<string, unknown>; search?: TestReply; route?: TestReply } = {},
) =>
  createTestModule(t, addon, {
    at: '2026-10-30T07:00:00Z',
    timeZone: 'Europe/Zurich',
    config: options.config ?? {},
    routes: {
      nominatim: options.search ?? (search as TestReply),
      '/route/v1': options.route ?? (route as TestReply),
    },
  });

test('définition conforme et outil annoncé', (t) => {
  const f = setup(t);
  assert.equal(validateAddonDefinition(addon), null);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.deepEqual(
    f.runtime.tools().map((tool) => tool.name),
    ['voiture__trajet'],
  );
});

test('sans question, le module attend un trajet au lieu d’échouer', async (t) => {
  const f = setup(t);
  // C'est ce que fait l'administration en testant une source neuve : pas de question, pas d'erreur.
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.primaryValue, 'Où ?');
  assert.match(result.presentation.summary, /Dites deux lieux/u);
});

test('un trajet donne la durée et la distance, sans trafic', async (t) => {
  const f = setup(t);
  const invoked = await f.invoke('trajet', { query: 'de Genève à Zurich' });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  assert.equal(invoked.outcome.card.primaryValue, '40 min');
  assert.deepEqual(invoked.outcome.card.items, [{ label: 'Distance', value: '62,0 km' }]);
  assert.match(invoked.outcome.presentation.summary, /hors trafic/u);
  // Deux recherches d'adresse, puis un seul calcul de route.
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls[0]?.url.includes('nominatim'));
  assert.ok(f.calls[2]?.url.includes('/route/v1/driving/6.1432,46.2044'));
  assert.deepEqual(f.contract(invoked.outcome), []);
});

test('« bureau » et « domicile » renvoient aux réglages', async (t) => {
  const f = setup(t, {
    config: { origine: 'Chailly, Lausanne', destination: 'EPFL, Lausanne' },
  });
  const invoked = await f.invoke('trajet', { query: 'bureau' });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  const url = f.calls[0]?.url ?? '';
  assert.ok(url.includes('q=Chailly%2C+Lausanne'));
  assert.ok((f.calls[1]?.url ?? '').includes('q=EPFL%2C+Lausanne'));
});

test('sans départ réglé, une destination seule est refusée', async (t) => {
  const f = setup(t);
  const invoked = await f.invoke('trajet', { query: 'Genève' });
  assert.equal(invoked.outcome.ok, false);
  if (invoked.outcome.ok) return;
  assert.equal(invoked.outcome.error.code, 'config_invalid');
  assert.equal(f.calls.length, 0);
});

test('un lieu inconnu est dit, sans calculer de route', async (t) => {
  const f = setup(t, { search: [] });
  const invoked = await f.invoke('trajet', { query: 'de Nulle-Part à Zurich' });
  assert.equal(invoked.outcome.ok, false);
  if (invoked.outcome.ok) return;
  assert.equal(invoked.outcome.error.code, 'not_found');
  assert.equal(
    f.calls.some((call) => call.url.includes('/route/v1')),
    false,
  );
});
