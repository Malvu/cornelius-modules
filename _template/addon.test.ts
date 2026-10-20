import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon from './index.js';
import payload from './fixtures/availability.json' with { type: 'json' };

/**
 * Le module tourne dans le vrai cœur de Cornelius : base en mémoire, horloge réglable,
 * réseau simulé par une table d'adresses (la clé est cherchée dans l'adresse demandée).
 */
const setup = (t: { after(fn: () => void): void }) =>
  createTestModule(t, addon, {
    at: '2026-09-22T10:00:00Z',
    routes: { '/parkings/': payload },
  });

test('définition, réglages, contrat et adresse interrogée', async (t) => {
  const f = setup(t);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(f.runtime.validateConfig(addon.id, { parkingId: '../autre' }).ok, false);
  const result = await f.read();
  // Un seul contrôle pour la définition, le relevé, la carte, l'affichage et l'outil.
  assert.deepEqual(f.contract(result), []);
  assert.equal(result.ok && result.card.primaryValue, '12 places');
  assert.equal(result.ok && result.snapshot.validUntil, '2026-09-22T10:01:00.000Z');
  assert.equal(f.calls[0]?.url, 'https://parking.example.invalid/parkings/demo');
  assert.ok(f.calls[0]?.signal);
});

test('les lectures simultanées et le cache frais ne doublent pas la collecte', async (t) => {
  const f = setup(t);
  const [first, second] = await Promise.all([f.read(), f.read()]);
  assert.equal(first.ok && second.ok, true);
  await f.read();
  assert.equal(f.calls.length, 1);
});

test('zéro place reste un succès utile', async (t) => {
  const f = setup(t);
  f.route({ '/parkings/': { ...payload, available: 0 } });
  const result = await f.read();
  assert.equal(result.ok && result.snapshot.status, 'ready');
  assert.equal(result.ok && result.card.primaryValue, '0 places');
});

test('une panne après expiration conserve les dates et annonce le dernier succès', async (t) => {
  const f = setup(t);
  const first = await f.read();
  assert.equal(first.ok, true);
  if (!first.ok) return;
  f.advance(60_001);
  f.route({ '/parkings/': { status: 503 } });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stale, true);
  assert.equal(result.snapshot.revision, first.snapshot.revision);
  assert.equal(result.snapshot.fetchedAt, first.snapshot.fetchedAt);
  assert.match(result.presentation.summary, /Dernière disponibilité connue/u);
  assert.equal(f.runtime.toolResult(result).status, 'stale');
});

test('une première panne ne crée ni données ni date de succès', async (t) => {
  const f = setup(t);
  f.route({ '/parkings/': { status: 503 } });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'unavailable');
  const snapshot = f.instances.getSnapshot(f.instance);
  assert.equal(snapshot?.status, 'error');
  assert.equal(snapshot?.data, null);
  assert.equal(snapshot?.fetchedAt, null);
});

test('une valeur fournisseur invalide est signalée, jamais convertie en zéro', async (t) => {
  const f = setup(t);
  f.route({ '/parkings/': { ...payload, available: 'inconnu' } });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'malformed');
});

test('une référence inconnue ne déclenche aucune requête', async (t) => {
  const f = setup(t);
  const result = await f.runtime.read(addon.id, null, 'autre', new AbortController().signal);
  assert.equal(result.ok, false);
  assert.equal(f.calls.length, 0);
});
