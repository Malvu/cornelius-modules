import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon, { parseRule } from './index.js';

/** Mardi 20 octobre 2026 : semaine ISO 43, impaire ; heure de Paris = UTC + 2. */
const setup = (
  t: { after(fn: () => void): void },
  at: string,
  config: Record<string, unknown> = {},
  timeZone?: string,
) => createTestModule(t, addon, { at, config, timeZone });

test('définition, réglages et contrat, sans aucun appel réseau', async (t) => {
  const f = setup(t, '2026-10-20T08:00:00Z');
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  for (const bacs of [[], [{ bac: 'pneus', jours: 'lundi' }], [{ bac: 'verre', jours: '' }]])
    assert.equal(
      f.runtime.validateConfig(addon.id, { bacs, veille: true }).ok,
      false,
      JSON.stringify(bacs),
    );
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
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
  assert.equal(evening.ok && evening.card.primaryValue, 'Ce soir');
  assert.match(
    evening.ok ? evening.presentation.summary : '',
    /^Ce soir, on sort les ordures ménagères : ramassage demain matin\./u,
  );
  assert.equal(f.ambient().content?.value, 'Ce soir');

  const plain = await setup(t, '2026-10-21T16:00:00Z', { veille: false }).read();
  assert.equal(plain.ok && plain.card.primaryValue, 'Demain');
  const afternoon = await setup(t, '2026-10-21T12:00:00Z').read(); // 14 h : trop tôt
  assert.equal(afternoon.ok && afternoon.card.primaryValue, 'Demain');
});

test('l’affichage se recalcule à midi, à 17 h et à minuit, sans collecte', async (t) => {
  const f = setup(t, '2026-10-21T08:00:00Z'); // mercredi 10 h
  await f.read();
  assert.equal(f.ambient().content?.refreshAt, '2026-10-21T10:00:00.000Z'); // midi
  f.at('2026-10-21T11:00:00Z'); // 13 h
  assert.equal(f.ambient().content?.refreshAt, '2026-10-21T15:00:00.000Z'); // 17 h
  assert.equal(f.ambient().content?.value, 'Demain');
  f.at('2026-10-21T15:00:00Z'); // 17 h pile
  assert.equal(f.ambient().content?.value, 'Ce soir');
  assert.equal(f.ambient().content?.refreshAt, '2026-10-21T22:00:00.000Z'); // minuit
  f.at('2026-10-22T05:00:00Z'); // jeudi 7 h
  assert.equal(f.ambient().content?.value, 'Aujourd’hui');
  assert.equal(f.calls.length, 0);
});

test('rang dans le mois, dernier jour du mois, bacs le même jour, bac sur deux lignes', async (t) => {
  const f = setup(t, '2026-10-20T08:00:00Z', {
    bacs: [
      { bac: 'menager', jours: 'vendredi' },
      { bac: 'verre', jours: 'dernier vendredi du mois' },
      { bac: 'vegetaux', jours: '1er mercredi du mois' },
      // Deux rythmes pour un même bac (vendredi 23, mardi 27) : il compte une fois, au plus tôt.
      { bac: 'menager', jours: 'mardi semaines paires' },
    ],
  });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.card.items, [
    { label: 'Ordures ménagères', value: 'Vendredi 23 octobre' },
    { label: 'Verre', value: 'Vendredi 30 octobre' },
    { label: 'Déchets verts', value: 'Mercredi 4 novembre' },
  ]);
  f.at('2026-10-29T16:00:00Z'); // jeudi 29, 18 h : demain, deux bacs
  const both = await f.read();
  assert.match(
    both.ok ? both.presentation.summary : '',
    /^Ce soir, on sort les ordures ménagères et le verre/u,
  );
});

test('les réglages de la version 1, un champ par bac, sont repris en liste', async (t) => {
  assert.deepEqual(
    addon.configMigrate!(1, {
      menager: 'lundi et jeudi',
      emballages: '  ',
      verre: '1er vendredi du mois',
      biodechets: null,
      vegetaux: null,
      veille: false,
    }),
    {
      bacs: [
        { bac: 'menager', jours: 'lundi et jeudi' },
        { bac: 'verre', jours: '1er vendredi du mois' },
      ],
      veille: false,
    },
  );
  assert.throws(() => addon.configMigrate!(9, {}), /inconnus/u);
  // Une source enregistrée en version 1 se lit sans être réglée à nouveau.
  const f = setup(t, '2026-10-20T08:00:00Z');
  f.instances.updateInstance(f.instance.id, {
    config: {
      menager: 'vendredi',
      emballages: null,
      verre: null,
      biodechets: null,
      vegetaux: null,
      veille: true,
    },
    configVersion: 1,
  });
  const result = await f.runtime.read(addon.id, null, 'test', new AbortController().signal);
  assert.equal(result.ok && result.card.primaryValue, 'Vendredi 23 octobre');
});

test('le jour et l’heure suivent le fuseau du foyer', async (t) => {
  // 22 h à Paris (veille possible), mais 0 h le lendemain à La Réunion : déjà jeudi.
  const f = setup(t, '2026-10-21T20:00:00Z', {}, 'Indian/Reunion');
  const result = await f.read();
  assert.equal(result.ok && result.card.primaryValue, 'Aujourd’hui');
});

test('une règle incomprise est une erreur de réglage', async (t) => {
  const wrong = await setup(t, '2026-10-20T08:00:00Z', {
    bacs: [{ bac: 'verre', jours: 'le mardo' }],
  }).read();
  assert.equal(wrong.ok, false);
  if (!wrong.ok) {
    assert.equal(wrong.error.code, 'config_invalid');
    assert.match(wrong.error.message, /^Verre : « mardo » n’est pas compris/u);
  }
});
