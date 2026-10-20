import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AddonRepository,
  AddonRuntime,
  openDatabase,
  validateAddonDefinition,
} from '#cornelius/testing';
import type { AddonHttpRequest } from '#cornelius/addons';
import { validators } from '#cornelius/validation';
import addon from './index.js';

const ics = readFileSync(new URL('./fixtures/famille.ics', import.meta.url), 'utf8');
const secretUrl =
  'https://calendar.google.com/calendar/ical/famille%40example.com/private-0123456789abcdef/basic.ics';

function setup(
  t: { after(fn: () => void): void },
  config: Record<string, unknown> = {},
  reply: { status: number; body: string } = { status: 200, body: ics },
  at = '2026-10-20T08:00:00Z',
) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const instances = new AddonRepository(db);
  const instance = instances.createInstance({
    addonId: addon.id,
    profileId: null,
    ref: 'famille',
    label: 'Agenda de la famille',
    config: { url: secretUrl, days: 7, ...config },
    configVersion: addon.configVersion,
  });
  let now = Date.parse(at);
  let current = reply;
  const calls: AddonHttpRequest[] = [];
  const runtime = new AddonRuntime({
    addons: [addon],
    instances,
    now: () => now,
    http: {
      async fetch(request) {
        calls.push(request);
        return {
          status: current.status,
          headers: {},
          text: () => current.body,
          json: () => JSON.parse(current.body) as unknown,
        };
      },
    },
  });
  return {
    runtime,
    instances,
    instance,
    calls,
    read: () => runtime.read(addon.id, null, 'famille', new AbortController().signal),
    at: (iso: string) => {
      now = Date.parse(iso);
    },
    reply: (next: { status: number; body: string }) => {
      current = next;
    },
  };
}

test('définition v1, configuration, snapshot, carte et résultat outil conformes', async (t) => {
  const f = setup(t);
  assert.equal(validateAddonDefinition(addon), null);
  for (const url of [secretUrl, 'webcal://p01-caldav.icloud.com/published/2/abc'])
    assert.equal(f.runtime.validateConfig(addon.id, { url, days: 7 }).ok, true, url);
  for (const config of [
    { url: 'ftp://exemple.fr/a.ics', days: 7 },
    { url: 'https://exemple.fr/a b.ics', days: 7 },
    { url: secretUrl, days: 30 },
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
  assert.equal(f.calls[0]?.url, secretUrl);
});

test('le lien privé n’apparaît ni dans le relevé, ni sur la carte, ni à l’oral', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const stored = JSON.stringify(f.instances.getSnapshot(f.instance));
  const shown = JSON.stringify([result.card, result.presentation, f.runtime.toolResult(result)]);
  for (const text of [stored, shown]) {
    assert.equal(text.includes('private-0123456789abcdef'), false);
    assert.equal(text.includes('calendar.google.com'), false);
  }
});

test('la semaine : rendez-vous en cours d’abord, puis par jour, à l’oral comme sur la carte', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.title, 'Agenda · Famille');
  assert.equal(result.card.primaryValue, "Réunion d'école");
  assert.equal(result.card.subtitle, 'Aujourd’hui, en cours, jusqu’à 11 h');
  assert.deepEqual(result.card.items, [
    { label: 'Aujourd’hui 16 h', value: 'Dentiste de Léa · Cabinet du Dr Martin, Pacé' },
    { label: 'Aujourd’hui 18 h', value: 'Séance photo' },
    { label: 'Demain 18 h 30', value: 'Foot de Tom' },
    { label: 'Jeu. 22 oct. · journée', value: 'Anniversaire de Mamie' },
    {
      label: 'Jeu. 22 oct. 14 h',
      value:
        "Visio avec les cousins d'Amérique pour préparer les fêtes de fin d'année et la grande réunion de famille",
    },
  ]);
  assert.equal(
    result.presentation.summary,
    "Aujourd’hui : Réunion d'école en cours, jusqu’à 11 h, Dentiste de Léa à 16 h et Séance photo à 18 h. " +
      'Demain : Foot de Tom à 18 h 30. ' +
      "Jeudi 22 octobre : Anniversaire de Mamie toute la journée et Visio avec les cousins d'Amérique " +
      "pour préparer les fêtes de fin d'année et la grande réunion de famille à 14 h. " +
      'Et 4 autres dans les 7 prochains jours.',
  );
});

test('un séjour de plusieurs jours se dit jusqu’à son dernier jour', async (t) => {
  const f = setup(t, {}, undefined, '2026-10-24T06:00:00Z'); // samedi, 8 h
  const saturday = await f.read();
  assert.equal(saturday.ok, true);
  if (!saturday.ok) return;
  assert.equal(saturday.card.primaryValue, 'Stage de voile');
  assert.equal(saturday.card.subtitle, 'Aujourd’hui, jusqu’au lundi 26 octobre');
  assert.equal(saturday.card.items[0]?.label, 'Aujourd’hui 11 h');
});

test('un rendez-vous fini disparaît sans attendre la collecte suivante', async (t) => {
  const f = setup(t, {}, undefined, '2026-10-20T08:50:00Z'); // 10 h 50 : réunion en cours
  const during = await f.read();
  assert.equal(during.ok, true);
  if (during.ok) assert.equal(during.card.primaryValue, "Réunion d'école");
  f.at('2026-10-20T09:04:00Z'); // 11 h 04 : finie, relevé encore frais
  const after = await f.read();
  assert.equal(after.ok, true);
  if (after.ok) assert.equal(after.card.primaryValue, 'Dentiste de Léa');
  assert.equal(f.calls.length, 1);
});

test('« webcal:// » est lu en https ; une semaine vide est une réponse', async (t) => {
  const empty = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
  const f = setup(
    t,
    { url: 'webcal://p01-caldav.icloud.com/published/2/abc', days: 3 },
    { status: 200, body: empty },
  );
  const result = await f.read();
  assert.equal(f.calls[0]?.url, 'https://p01-caldav.icloud.com/published/2/abc');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.primaryValue, 'Rien de prévu');
  assert.equal(result.presentation.summary, 'Rien de prévu dans les 3 prochains jours.');
  assert.equal(f.runtime.ambientDisplay(f.instance).content?.value, 'Rien de prévu');
});

test('lien réinitialisé, introuvable, page web : des messages sans le lien', async (t) => {
  for (const [reply, code] of [
    [{ status: 403, body: '' }, 'forbidden'],
    [{ status: 404, body: '' }, 'not_found'],
    [{ status: 200, body: '<!DOCTYPE html><html>Connexion</html>' }, 'malformed'],
  ] as const) {
    const result = await setup(t, {}, reply).read();
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.error.code, code);
    assert.equal(result.error.message.includes('google'), false);
  }
});

test('panne après expiration : dernier agenda connu, annoncé comme tel', async (t) => {
  const f = setup(t);
  assert.equal((await f.read()).ok, true);
  f.at('2026-10-20T08:16:00Z');
  f.reply({ status: 503, body: '' });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stale, true);
  assert.match(result.presentation.summary, /^D’après le dernier agenda connu, à vérifier\./u);
});
