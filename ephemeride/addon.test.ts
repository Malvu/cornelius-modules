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
import addon from './index.js';
// Sélection de Wikipédia en français pour le 20 octobre (CC BY-SA 4.0), réduite au texte.
import selected from './fixtures/20-octobre.json' with { type: 'json' };

function setup(
  t: { after(fn: () => void): void },
  at = '2026-10-20T10:00:00Z',
  reply: { status: number; body: string } = { status: 200, body: JSON.stringify(selected) },
  config: Record<string, unknown> = {},
) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const instances = new AddonRepository(db);
  const instance = instances.createInstance({
    addonId: addon.id,
    profileId: null,
    ref: 'jour',
    label: 'Éphéméride',
    config: { ...addon.configDefaults, ...config },
    configVersion: addon.configVersion,
  });
  let now = Date.parse(at);
  const calls: AddonHttpRequest[] = [];
  const runtime = new AddonRuntime({
    addons: [addon],
    instances,
    now: () => now,
    http: {
      async fetch(request) {
        calls.push(request);
        return {
          status: reply.status,
          headers: {},
          text: () => reply.body,
          json: () => JSON.parse(reply.body) as unknown,
        };
      },
    },
  });
  return {
    runtime,
    instance,
    calls,
    read: () => runtime.read(addon.id, null, 'jour', new AbortController().signal),
    at: (iso: string) => {
      now = Date.parse(iso);
    },
  };
}

test('définition v1, configuration, snapshot, carte et résultat outil conformes', async (t) => {
  const f = setup(t);
  assert.equal(validateAddonDefinition(addon), null);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(f.runtime.validateConfig(addon.id, { count: 9 }).ok, false);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(validators.moduleSnapshot(result.snapshot), true);
  assert.equal(validators.moduleCard(result.card), true);
  assert.equal(validators.ambientPresentation(f.runtime.ambientDisplay(f.instance).content), true);
  assert.equal(validators.toolResult(f.runtime.toolResult(result)), true);
  assert.equal(
    f.calls[0]?.url,
    'https://fr.wikipedia.org/api/rest_v1/feed/onthisday/selected/10/20',
  );
  assert.match(f.calls[0]?.headers?.['User-Agent'] ?? '', /^Cornelius-modules\//u);
});

test('l’anniversaire le plus rond d’abord, puis les autres', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // 2026 : 2011 fait 15 ans (multiple de 5), les autres ne tombent pas rond.
  assert.equal(result.card.title, 'Éphéméride · 20 octobre');
  assert.equal(result.card.primaryValue, 'Il y a 15 ans');
  assert.equal(result.card.subtitle, 'En 2011');
  assert.equal(
    result.presentation.summary,
    'Un jour comme aujourd’hui, il y a 15 ans, en 2011 : ' +
      "l'ETA annonce la « fin définitive de son action armée ».",
  );
  assert.deepEqual(
    result.card.items.map((item) => item.label),
    ['2024', '1962'],
  );
  assert.match(result.card.items[1]!.value, /^Déclenchement de la guerre sino-indienne\.$/u);
  const ambient = f.runtime.ambientDisplay(f.instance).content;
  assert.equal(ambient?.layout, 'list');
  assert.equal(ambient?.title, 'Un 20 octobre');
});

test('le jour suit l’heure de Paris, et la date change après minuit', async (t) => {
  const f = setup(t, '2026-10-19T22:30:00Z'); // 0 h 30 le 20 à Paris
  await f.read();
  assert.equal(f.calls[0]?.url.endsWith('/selected/10/20'), true);
  const g = setup(t, '2026-03-05T10:00:00Z');
  await g.read();
  assert.equal(g.calls[0]?.url.endsWith('/selected/03/05'), true);
});

test('un relevé de la veille se dit à sa date, pas « aujourd’hui »', async (t) => {
  const f = setup(t, '2026-10-20T21:30:00Z'); // 23 h 30 le 20 à Paris
  await f.read();
  f.at('2026-10-20T22:10:00Z'); // 0 h 10 le 21 : relevé encore frais
  const result = await f.read();
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.presentation.summary, /^Un 20 octobre, il y a 15 ans/u);
  assert.equal(f.calls.length, 1);
});

test('pannes, réponse inattendue et jour sans sélection', async (t) => {
  const down = await setup(t, undefined, { status: 503, body: '' }).read();
  assert.equal(down.ok, false);
  if (!down.ok) assert.equal(down.error.code, 'unavailable');
  const odd = await setup(t, undefined, { status: 200, body: '{"events": []}' }).read();
  assert.equal(odd.ok, false);
  if (!odd.ok) assert.equal(odd.error.code, 'malformed');
  const none = await setup(t, undefined, { status: 200, body: '{"selected": []}' }).read();
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.status, 'empty');
});
