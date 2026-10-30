import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule, validateAddonDefinition, type TestReply } from '#cornelius/testing';
import addon from './index.js';
import routes from './fixtures/routes.json' with { type: 'json' };

const setup = (
  t: { after(fn: () => void): void },
  options: { config?: Record<string, unknown>; route?: TestReply; secret?: boolean } = {},
) =>
  createTestModule(t, addon, {
    at: '2026-10-30T07:00:00Z',
    timeZone: 'Europe/Zurich',
    config: options.config,
    routes: { computeRoutes: options.route ?? (routes as TestReply) },
    ...(options.secret === false ? {} : { secrets: { googleKey: 'cle-de-test' } }),
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

test('un trajet donne la durée, la distance et le trafic', async (t) => {
  const f = setup(t);
  const invoked = await f.invoke('trajet', { query: 'Genève' });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  // Le départ vient du réglage : 40 minutes roulantes, 48 avec le trafic.
  assert.equal(invoked.outcome.card.primaryValue, '48 min');
  assert.equal(invoked.outcome.card.subtitle, 'Domicile, Lausanne → Genève');
  assert.deepEqual(invoked.outcome.card.items, [
    { label: 'Distance', value: '62,0 km' },
    { label: 'Trafic', value: '+8 min' },
  ]);
  assert.match(invoked.outcome.presentation.summary, /dont 8 minutes de trafic/u);
  assert.deepEqual(f.contract(invoked.outcome), []);
});

test('deux bouts dans la question, et « domicile » renvoie au réglage', async (t) => {
  const f = setup(t);
  const invoked = await f.invoke('trajet', { query: 'domicile > Genève' });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  const call = f.calls[0];
  assert.equal(call?.method, 'POST');
  const body = JSON.parse(call?.body ?? '{}');
  assert.deepEqual(body.origin, { address: 'Domicile, Lausanne' });
  assert.deepEqual(body.destination, { address: 'Genève' });
  assert.equal(body.travelMode, 'DRIVE');
  assert.equal(body.routingPreference, 'TRAFFIC_AWARE');
  assert.ok((call?.headers?.['X-Goog-FieldMask'] ?? '').includes('routes.duration'));
});

test('« bureau » désigne la destination réglée', async (t) => {
  const f = setup(t, { config: { destination: 'EPFL, Lausanne' } });
  const invoked = await f.invoke('trajet', { query: 'bureau' });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  assert.equal(invoked.outcome.card.subtitle, 'Domicile, Lausanne → EPFL, Lausanne');
});

test('sans clé, le module dit quoi faire', async (t) => {
  const f = setup(t, { secret: false });
  const invoked = await f.invoke('trajet', { query: 'Genève' });
  assert.equal(invoked.outcome.ok, false);
  if (invoked.outcome.ok) return;
  assert.equal(invoked.outcome.error.code, 'config_invalid');
  assert.match(invoked.outcome.error.message, /CORNELIUS_GOOGLE_MAPS_KEY/u);
  assert.equal(f.calls.length, 0);
});

test('un refus de Google est dit tel quel', async (t) => {
  const f = setup(t, {
    route: { error: { status: 'NOT_FOUND', message: 'no route' } },
  });
  const invoked = await f.invoke('trajet', { query: 'Nulle-Part' });
  assert.equal(invoked.outcome.ok, false);
  if (invoked.outcome.ok) return;
  assert.equal(invoked.outcome.error.code, 'not_found');
});

test('le trafic absent ne fabrique pas de chiffre', async (t) => {
  const f = setup(t, {
    route: {
      routes: [{ duration: '600s', distanceMeters: 5000 }],
    },
  });
  const invoked = await f.invoke('trajet', { query: 'Genève' });
  assert.equal(invoked.outcome.ok, true);
  if (!invoked.outcome.ok) return;
  assert.deepEqual(invoked.outcome.card.items, [{ label: 'Distance', value: '5,0 km' }]);
  assert.match(invoked.outcome.presentation.summary, /^En voiture de Domicile, Lausanne à Genève/u);
});
