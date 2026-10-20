import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AddonRepository,
  AddonRuntime,
  openDatabase,
  validateAddonDefinition,
} from '#cornelius/testing';
import type { AddonHttpRequest } from '#cornelius/addons';
import { validators } from '#cornelius/validation';
import addon, { parseRule } from './index.js';

/** Mardi 20 octobre 2026 : semaine ISO 43, impaire ; heure de Paris = UTC + 2. */
function setup(
  t: { after(fn: () => void): void },
  at: string,
  config: Record<string, unknown> = {},
) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const instances = new AddonRepository(db);
  const instance = instances.createInstance({
    addonId: addon.id,
    profileId: null,
    ref: 'maison',
    label: 'Poubelles de la maison',
    config: { ...addon.configDefaults, ...config },
    configVersion: addon.configVersion,
  });
  let now = Date.parse(at);
  const calls: AddonHttpRequest[] = [];
  const runtime = new AddonRuntime({
    addons: [addon],
    instances,
    http: {
      async fetch(request) {
        calls.push(request);
        throw new Error('aucun réseau attendu');
      },
    },
    now: () => now,
  });
  return {
    runtime,
    instance,
    calls,
    read: () => runtime.read(addon.id, null, 'maison', new AbortController().signal),
    at: (iso: string) => {
      now = Date.parse(iso);
    },
  };
}

test('définition v1, configuration, snapshot, carte et résultat outil conformes', async (t) => {
  const f = setup(t, '2026-10-20T08:00:00Z');
  assert.equal(validateAddonDefinition(addon), null);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(
    f.runtime.validateConfig(addon.id, { ...addon.configDefaults, verre: 'x'.repeat(81) }).ok,
    false,
  );
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(validators.moduleSnapshot(result.snapshot), true);
  assert.equal(validators.moduleCard(result.card), true);
  assert.equal(validators.ambientPresentation(f.runtime.ambientDisplay(f.instance).content), true);
  assert.equal(validators.toolResult(f.runtime.toolResult(result)), true);
  assert.equal(f.calls.length, 0);
});

test('les règles en toutes lettres sont comprises', () => {
  assert.deepEqual(parseRule('lundi et jeudi'), { weekdays: [1, 4], parity: 'all', ordinals: [] });
  assert.deepEqual(parseRule('Lundis, Jeudis'), { weekdays: [1, 4], parity: 'all', ordinals: [] });
  assert.deepEqual(parseRule('mercredi semaines paires'), {
    weekdays: [3],
    parity: 'even',
    ordinals: [],
  });
  assert.deepEqual(parseRule('le mardi des semaines impaires'), {
    weekdays: [2],
    parity: 'odd',
    ordinals: [],
  });
  assert.deepEqual(parseRule('1er et 3e mercredi du mois'), {
    weekdays: [3],
    parity: 'all',
    ordinals: [1, 3],
  });
  assert.deepEqual(parseRule('dernier vendredi du mois'), {
    weekdays: [5],
    parity: 'all',
    ordinals: [-1],
  });
  assert.deepEqual(parseRule('tous les samedis matin'), {
    weekdays: [6],
    parity: 'all',
    ordinals: [],
  });
  assert.throws(() => parseRule('mardo'), /« mardo » n’est pas compris/u);
  assert.throws(() => parseRule('semaines paires'), /aucun jour/u);
  assert.throws(() => parseRule('1er mardi semaines paires'), /choisir entre/u);
});

test('le prochain ramassage, puis les suivants de chaque bac', async (t) => {
  const f = setup(t, '2026-10-20T08:00:00Z');
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.primaryValue, 'Jeudi 22 octobre');
  assert.equal(result.card.subtitle, 'Ordures ménagères');
  // Mercredi 21 est en semaine impaire : les emballages passent le 28, semaine 44.
  assert.deepEqual(result.card.items, [
    { label: 'Ordures ménagères', value: 'Jeudi 22 octobre' },
    { label: 'Emballages', value: 'Mercredi 28 octobre' },
  ]);
  assert.equal(
    result.presentation.summary,
    'Prochain ramassage jeudi 22 octobre : les ordures ménagères. ' +
      'Ensuite : les emballages mercredi 28 octobre.',
  );
});

test('la veille au soir : « ce soir, on sort… », seulement si l’option est active', async (t) => {
  const f = setup(t, '2026-10-21T16:00:00Z'); // mercredi, 18 h à Paris
  const evening = await f.read();
  assert.equal(evening.ok, true);
  if (!evening.ok) return;
  assert.equal(evening.card.primaryValue, 'Ce soir');
  assert.match(
    evening.presentation.summary,
    /^Ce soir, on sort les ordures ménagères : ramassage demain matin\./u,
  );
  assert.equal(f.runtime.ambientDisplay(f.instance).content?.value, 'Ce soir');

  const g = setup(t, '2026-10-21T16:00:00Z', { veille: false });
  const plain = await g.read();
  assert.equal(plain.ok, true);
  if (plain.ok) assert.equal(plain.card.primaryValue, 'Demain');

  const h = setup(t, '2026-10-21T12:00:00Z'); // 14 h : trop tôt pour le rappel du soir
  const afternoon = await h.read();
  assert.equal(afternoon.ok, true);
  if (afternoon.ok) assert.equal(afternoon.card.primaryValue, 'Demain');
});

test('le jour du ramassage compte jusqu’à midi, puis on passe au suivant', async (t) => {
  const f = setup(t, '2026-10-22T05:00:00Z'); // jeudi, 7 h à Paris
  const morning = await f.read();
  assert.equal(morning.ok, true);
  if (morning.ok) assert.equal(morning.card.primaryValue, 'Aujourd’hui');
  f.at('2026-10-22T11:00:00Z'); // 13 h : le camion est passé
  const afternoon = await f.read();
  assert.equal(afternoon.ok, true);
  if (afternoon.ok) assert.equal(afternoon.card.primaryValue, 'Lundi 26 octobre');
});

test('rang dans le mois, dernier jour du mois et bacs le même jour', async (t) => {
  const f = setup(t, '2026-10-20T08:00:00Z', {
    menager: 'vendredi',
    emballages: null,
    verre: 'dernier vendredi du mois',
    vegetaux: '1er mercredi du mois',
  });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.subtitle, 'Ordures ménagères');
  assert.deepEqual(result.card.items, [
    { label: 'Ordures ménagères', value: 'Vendredi 23 octobre' },
    { label: 'Verre', value: 'Vendredi 30 octobre' },
    { label: 'Déchets verts', value: 'Mercredi 4 novembre' },
  ]);
  f.at('2026-10-29T16:00:00Z'); // jeudi 29, 18 h : demain, deux bacs
  const both = await f.read();
  assert.equal(both.ok, true);
  if (both.ok)
    assert.match(both.presentation.summary, /^Ce soir, on sort les ordures ménagères et le verre/u);
});

test('une règle incomprise ou un calendrier vide est une erreur de réglage', async (t) => {
  const f = setup(t, '2026-10-20T08:00:00Z', { verre: 'le mardo' });
  const wrong = await f.read();
  assert.equal(wrong.ok, false);
  if (!wrong.ok) {
    assert.equal(wrong.error.code, 'config_invalid');
    assert.match(wrong.error.message, /^Verre : « mardo » n’est pas compris/u);
  }
  const g = setup(t, '2026-10-20T08:00:00Z', { menager: null, emballages: '  ' });
  const empty = await g.read();
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.error.code, 'config_invalid');
});
