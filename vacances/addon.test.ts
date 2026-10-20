import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon from './index.js';
import calendar from './fixtures/calendrier-zone-c.json' with { type: 'json' };
import holidays from './fixtures/jours-feries-metropole.json' with { type: 'json' };

/** Réponses enregistrées le 20/10/2026 : zone C (2026-2028) et jours fériés de métropole. */
const routes = { 'calendrier.api.gouv.fr': holidays, 'data.education.gouv.fr': calendar };

function setup(
  t: { after(fn: () => void): void },
  at: string,
  config: Record<string, unknown> = {},
  timeZone?: string,
) {
  return createTestModule(t, addon, { at, config, routes, timeZone });
}

const decoded = (url: string) => decodeURIComponent(url.replace(/\+/gu, ' '));

test('définition, réglages, contrat et adresses interrogées', async (t) => {
  const f = setup(t, '2026-10-20T10:00:00Z');
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(f.runtime.validateConfig(addon.id, { zone: 'Corse', region: 'metropole' }).ok, true);
  for (const config of [
    { zone: 'D', region: 'metropole' },
    { zone: 'C', region: 'guadeloupe' },
    { zone: 'C" or zones="Zone A', region: 'metropole' },
  ])
    assert.equal(f.runtime.validateConfig(addon.id, config).ok, false, JSON.stringify(config));
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  const urls = f.calls.map((call) => decoded(call.url));
  assert.ok(urls.some((url) => url.includes('zones="Zone C" and end_date>="2026-10-20"')));
  assert.ok(urls.includes('https://calendrier.api.gouv.fr/jours-feries/metropole.json'));
  assert.ok(f.calls.every((call) => call.signal));
});

test('pendant les vacances : en cours, jour de la rentrée et prochain férié', async (t) => {
  const f = setup(t, '2026-10-20T10:00:00Z');
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.title, 'Vacances scolaires · zone C');
  assert.equal(result.card.primaryValue, 'En vacances');
  assert.equal(result.card.subtitle, 'Vacances de la Toussaint, rentrée lundi 2 novembre');
  assert.deepEqual(result.card.items[0], { label: 'Noël', value: '19 déc. → 3 janv.' });
  assert.deepEqual(result.card.items.at(-1), {
    label: 'Prochain jour férié',
    value: 'Toussaint, dimanche 1er novembre (dans 12 jours)',
  });
  assert.equal(
    result.presentation.summary,
    'Zone C : vacances de la Toussaint en cours, rentrée lundi 2 novembre. ' +
      'Prochain jour férié : Toussaint, dimanche 1er novembre (dans 12 jours).',
  );
  const ambient = f.ambient().content;
  assert.equal(ambient?.value, 'En vacances');
  assert.equal(ambient?.subtitle, 'Rentrée lundi 2 novembre');
  assert.equal(ambient?.showCollectedAt, false);
});

test('hors vacances : compte à rebours et dates du premier au dernier jour', async (t) => {
  const f = setup(t, '2026-11-05T10:00:00Z');
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.primaryValue, 'Dans 44 jours');
  assert.equal(
    result.card.subtitle,
    'Vacances de Noël, du samedi 19 décembre au dimanche 3 janvier',
  );
  assert.deepEqual(
    result.card.items.map((item) => item.label),
    ['Hiver', 'Printemps', 'Été', 'Prochain jour férié'],
  );
  assert.match(
    result.presentation.summary,
    /^Zone C : prochaines vacances dans 44 jours : vacances de Noël/u,
  );
  assert.match(result.presentation.summary, /11 novembre, mercredi 11 novembre \(dans 6 jours\)/u);
});

test('le jour de la rentrée n’est plus un jour de vacances', async (t) => {
  const f = setup(t, '2026-11-02T06:00:00Z');
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.primaryValue, 'Dans 47 jours');
});

test('ponts, lignes enseignants et repères de début sont écartés, sans doublon', async (t) => {
  const f = setup(t, '2026-11-05T10:00:00Z');
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const vacations = result.snapshot.data!.vacations as { name: string }[];
  assert.deepEqual(
    vacations.map((vacation) => vacation.name),
    [
      'Vacances de Noël',
      "Vacances d'hiver",
      'Vacances de printemps',
      "Vacances d'été",
      'Vacances de la Toussaint',
      'Vacances de Noël',
    ],
  );
  // L'été des élèves : du samedi 3 juillet à la rentrée du jeudi 2 septembre 2027.
  assert.deepEqual(vacations[3], {
    name: "Vacances d'été",
    start: '2027-07-03',
    end: '2027-09-02',
  });
});

test('la situation suit le calendrier entre deux collectes, sans nouvelle requête', async (t) => {
  const f = setup(t, '2026-11-05T22:50:00Z');
  await f.read();
  f.advance(20 * 60 * 1000); // Minuit passé à Paris : on est le lendemain.
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.primaryValue, 'Dans 43 jours');
  assert.equal(f.calls.length, 2);
});

test('l’Alsace-Moselle interroge son propre calendrier des jours fériés', async (t) => {
  const f = setup(t, '2026-10-20T10:00:00Z', { zone: 'B', region: 'alsace-moselle' });
  const result = await f.read();
  assert.equal(result.ok, true);
  const urls = f.calls.map((call) => decodeURIComponent(call.url.replace(/\+/gu, ' ')));
  assert.ok(urls.includes('https://calendrier.api.gouv.fr/jours-feries/alsace-moselle.json'));
  assert.ok(urls.some((url) => url.includes('zones="Zone B"')));
});

test('une panne après expiration annonce le dernier calendrier connu', async (t) => {
  const f = setup(t, '2026-11-05T10:00:00Z');
  const first = await f.read();
  assert.equal(first.ok, true);
  f.advance(12 * 60 * 60 * 1000 + 1);
  f.route({ 'data.education.gouv.fr': { status: 503 } });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stale, true);
  assert.match(result.presentation.summary, /^D’après le dernier calendrier connu, à vérifier\./u);
  assert.equal(f.runtime.toolResult(result).status, 'stale');
});

test('une première panne ne crée ni données ni date de succès', async (t) => {
  const f = setup(t, '2026-11-05T10:00:00Z');
  f.route({ 'calendrier.api.gouv.fr': { status: 503 } });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'unavailable');
  assert.equal(f.instances.getSnapshot(f.instance)?.data, null);
});

test('une réponse inattendue est signalée, jamais convertie en calendrier vide', async (t) => {
  for (const [key, body] of [
    ['calendar', '{"results": "aucun"}'],
    ['calendar', JSON.stringify({ results: [{ ...calendar.results[0], start_date: 'bientôt' }] })],
    ['holidays', '{"demain": "Fête"}'],
    ['holidays', 'pas du JSON'],
  ] as const) {
    const f = setup(t, '2026-11-05T10:00:00Z');
    f.route({
      [key === 'calendar' ? 'data.education.gouv.fr' : 'calendrier.api.gouv.fr']: {
        status: 200,
        body,
      },
    });
    const result = await f.read();
    assert.equal(result.ok, false, body);
    if (!result.ok) assert.equal(result.error.code, 'malformed', body);
  }
});

test('rien de publié à venir : le module le dit, statut « empty »', async (t) => {
  const f = setup(t, '2026-11-05T10:00:00Z');
  f.route({
    'data.education.gouv.fr': { total_count: 0, results: [] },
    'calendrier.api.gouv.fr': { '2020-01-01': '1er janvier' },
  });
  const result = await f.read();
  assert.equal(result.ok, true);
  assert.equal(f.instances.getSnapshot(f.instance)?.status, 'empty');
  const tool = await f.invoke();
  assert.equal(tool.tool.status, 'empty');
  assert.equal(tool.tool.summary, 'Zone C : aucune période de vacances publiée pour l’instant.');
});

test('la carte permanente se recalcule à minuit, heure du foyer', async (t) => {
  const f = setup(t, '2026-11-05T10:00:00Z');
  await f.read();
  assert.equal(f.ambient().content?.refreshAt, '2026-11-05T23:00:00.000Z');
  assert.equal(f.ambient().content?.value, 'Dans 44 jours');
  f.at('2026-11-05T23:00:00Z');
  assert.equal(f.ambient().content?.value, 'Dans 43 jours');
  // À La Réunion (UTC+4), le 6 novembre commence dès 20 h UTC.
  const g = setup(t, '2026-11-05T21:00:00Z', {}, 'Indian/Reunion');
  await g.read();
  assert.equal(g.ambient().content?.value, 'Dans 43 jours');
});
