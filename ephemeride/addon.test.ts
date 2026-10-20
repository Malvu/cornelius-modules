import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon from './index.js';
// Sélection de Wikipédia en français pour le 20 octobre (CC BY-SA 4.0), réduite au texte.
import selected from './fixtures/20-octobre.json' with { type: 'json' };

function setup(
  t: { after(fn: () => void): void },
  at = '2026-10-20T10:00:00Z',
  reply: { status: number; body: string } = { status: 200, body: JSON.stringify(selected) },
  config: Record<string, unknown> = {},
) {
  return createTestModule(t, addon, { config, at, ref: 'jour', routes: () => reply });
}

test('définition, réglages et contrat', async (t) => {
  const f = setup(t);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(f.runtime.validateConfig(addon.id, { count: 9 }).ok, false);
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  assert.equal(
    f.calls[0]?.url,
    'https://fr.wikipedia.org/api/rest_v1/feed/onthisday/selected/10/20',
  );
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
  const ambient = f.ambient().content;
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

test('à minuit, la sélection du nouveau jour ; en panne, la veille dite à sa date', async (t) => {
  const f = setup(t, '2026-10-20T21:30:00Z'); // 23 h 30 le 20 à Paris
  await f.read();
  // Le relevé du 20 vaut jusqu'à minuit, heure du foyer.
  assert.equal(f.instances.getSnapshot(f.instance)?.validUntil, '2026-10-20T22:00:00.000Z');
  f.at('2026-10-20T22:10:00Z'); // 0 h 10 le 21
  await f.read();
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[1]!.url, /\/selected\/10\/21$/u);

  // Wikipédia en panne après minuit : le dernier relevé, celui du 20, est dit à sa date.
  const g = setup(t, '2026-10-20T21:30:00Z');
  await g.read();
  g.at('2026-10-20T22:10:00Z');
  g.route(() => ({ status: 503 }));
  const stale = await g.read();
  assert.equal(stale.ok && stale.stale, true);
  assert.match(stale.ok ? stale.presentation.summary : '', /^Un 20 octobre, il y a 15 ans/u);
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
