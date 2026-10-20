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
import calendar from './fixtures/calendrier-zone-c.json' with { type: 'json' };
import holidays from './fixtures/jours-feries-metropole.json' with { type: 'json' };

type Reply = { status: number; body: string };

/** Réponses enregistrées le 20/10/2026 : zone C (2026-2028) et jours fériés de métropole. */
function setup(
  t: { after(fn: () => void): void },
  at: string,
  config: Record<string, unknown> = { ...addon.configDefaults },
) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const instances = new AddonRepository(db);
  const instance = instances.createInstance({
    addonId: addon.id,
    profileId: null,
    ref: 'maison',
    label: 'Vacances à la maison',
    config,
    configVersion: addon.configVersion,
  });
  let now = Date.parse(at);
  const replies: { calendar: Reply; holidays: Reply } = {
    calendar: { status: 200, body: JSON.stringify(calendar) },
    holidays: { status: 200, body: JSON.stringify(holidays) },
  };
  const calls: AddonHttpRequest[] = [];
  const http: AddonHttpClient = {
    async fetch(request) {
      calls.push(request);
      const reply = request.url.includes('calendrier.api.gouv.fr')
        ? replies.holidays
        : replies.calendar;
      return {
        status: reply.status,
        headers: {},
        text: () => reply.body,
        json: () => JSON.parse(reply.body) as unknown,
      };
    },
  };
  const runtime = new AddonRuntime({ addons: [addon], instances, http, now: () => now });
  return {
    runtime,
    instances,
    instance,
    calls,
    replies,
    read: () => runtime.read(addon.id, null, 'maison', new AbortController().signal),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('définition v1, configuration, snapshot, carte et résultat outil conformes', async (t) => {
  const f = setup(t, '2026-10-20T10:00:00Z');
  assert.equal(validateAddonDefinition(addon), null);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(f.runtime.validateConfig(addon.id, { zone: 'Corse', region: 'metropole' }).ok, true);
  for (const config of [
    { zone: 'D', region: 'metropole' },
    { zone: 'C', region: 'guadeloupe' },
    { zone: 'C" or zones="Zone A', region: 'metropole' },
  ])
    assert.equal(f.runtime.validateConfig(addon.id, config).ok, false, JSON.stringify(config));
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(validators.moduleSnapshot(result.snapshot), true);
  assert.equal(
    validators.moduleCard(result.card),
    true,
    JSON.stringify(validators.moduleCard.errors),
  );
  assert.equal(validators.ambientPresentation(f.runtime.ambientDisplay(f.instance).content), true);
  assert.equal(validators.toolResult(f.runtime.toolResult(result)), true);
  const urls = f.calls.map((call) => decodeURIComponent(call.url.replace(/\+/gu, ' ')));
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
  const ambient = f.runtime.ambientDisplay(f.instance).content;
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
  f.advance(60 * 60 * 1000 + 1);
  f.replies.calendar = { status: 503, body: '{}' };
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stale, true);
  assert.match(result.presentation.summary, /^D’après le dernier calendrier connu, à vérifier\./u);
  assert.equal(f.runtime.toolResult(result).status, 'stale');
});

test('une première panne ne crée ni données ni date de succès', async (t) => {
  const f = setup(t, '2026-11-05T10:00:00Z');
  f.replies.holidays = { status: 503, body: '{}' };
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
    f.replies[key] = { status: 200, body };
    const result = await f.read();
    assert.equal(result.ok, false, body);
    if (!result.ok) assert.equal(result.error.code, 'malformed', body);
  }
});

test('rien de publié à venir donne une source vide, pas une panne', async (t) => {
  const f = setup(t, '2026-11-05T10:00:00Z');
  f.replies.calendar = { status: 200, body: '{"total_count": 0, "results": []}' };
  f.replies.holidays = { status: 200, body: '{"2020-01-01": "1er janvier"}' };
  const result = await f.read();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 'empty');
  assert.equal(f.instances.getSnapshot(f.instance)?.status, 'empty');
});
