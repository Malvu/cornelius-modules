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

/** Flux réel de la chaîne des Frères Poulain, réduit à six entrées (trois Shorts), le 20/10/2026. */
const feed = readFileSync(new URL('./fixtures/freres-poulain.xml', import.meta.url), 'utf8');

function setup(
  t: { after(fn: () => void): void },
  config: Record<string, unknown> = {},
  reply: { status: number; body: string } = { status: 200, body: feed },
) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const instances = new AddonRepository(db);
  const instance = instances.createInstance({
    addonId: addon.id,
    profileId: null,
    ref: 'poulain',
    label: 'Les Frères Poulain',
    config: { ...addon.configDefaults, ...config },
    configVersion: addon.configVersion,
  });
  const calls: AddonHttpRequest[] = [];
  const runtime = new AddonRuntime({
    addons: [addon],
    instances,
    now: () => Date.parse('2026-10-20T10:00:00Z'),
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
    read: () => runtime.read(addon.id, null, 'poulain', new AbortController().signal),
  };
}

test('définition v1, configuration, snapshot, carte et résultat outil conformes', async (t) => {
  const f = setup(t);
  assert.equal(validateAddonDefinition(addon), null);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  for (const channelId of ['@LesFreresPoulain', 'UCcourt', 'https://youtube.com/channel/UC0'])
    assert.equal(
      f.runtime.validateConfig(addon.id, { ...addon.configDefaults, channelId }).ok,
      false,
      channelId,
    );
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(validators.moduleSnapshot(result.snapshot), true);
  assert.equal(validators.moduleCard(result.card), true);
  assert.equal(validators.ambientPresentation(f.runtime.ambientDisplay(f.instance).content), true);
  assert.equal(validators.toolResult(f.runtime.toolResult(result)), true);
  assert.equal(
    f.calls[0]?.url,
    'https://www.youtube.com/feeds/videos.xml?channel_id=UCjED9uS41ioeFuPfbR-OBlw',
  );
});

test('sans les Shorts : la dernière vidéo longue, ses vues et les précédentes', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.title, 'YouTube · Les Freres Poulain');
  assert.equal(result.card.primaryValue, 'Cette fois, impossible de perdre la clé de 13 !');
  assert.equal(result.card.subtitle, 'Publiée il y a 3 semaines');
  assert.equal(result.card.items[0]?.label, 'Vues');
  assert.match(result.card.items[0]!.value, /^\d[\d  ]*$/u);
  assert.deepEqual(
    result.card.items.slice(1).map((item) => item.value),
    [
      '17h au lieu de 37h (en MultiCouleur!) - Flashforge Creator 5',
      '180 jours pour sauver le manoir de famille, 0 € de budget',
    ],
  );
  assert.equal(
    result.presentation.summary,
    'Dernière vidéo de la chaîne Les Freres Poulain, publiée il y a 3 semaines : ' +
      '« Cette fois, impossible de perdre la clé de 13 ! ».',
  );
  const videos = result.snapshot.data!.videos as { short: boolean }[];
  assert.equal(
    videos.every((video) => !video.short),
    true,
  );
});

test('avec les Shorts : mots-clés retirés du titre, émojis retirés de l’oral', async (t) => {
  const f = setup(t, { shorts: true });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.card.primaryValue,
    "L'imprimante change de tête et change de couleur et matière !",
  );
  assert.equal(result.card.subtitle, 'Short publié il y a 2 semaines');

  const entries = feed.split(' <entry>');
  const fromGlaciere = [entries[0], ...entries.slice(3)].join(' <entry>');
  const g = setup(t, { shorts: true }, { status: 200, body: fromGlaciere });
  const glaciere = await g.read();
  assert.equal(glaciere.ok, true);
  if (!glaciere.ok) return;
  assert.equal(
    glaciere.card.primaryValue,
    'On a mis une batterie de perceuse dans une glacière 😅',
  );
  assert.match(
    glaciere.presentation.summary,
    /: « On a mis une batterie de perceuse dans une glacière »\.$/u,
  );
});

test('chaîne inconnue, page de consentement ou chaîne vide', async (t) => {
  const missing = await setup(t, {}, { status: 404, body: '' }).read();
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, 'not_found');

  const html = await setup(
    t,
    {},
    { status: 200, body: '<!DOCTYPE html><html>Avant de continuer</html>' },
  ).read();
  assert.equal(html.ok, false);
  if (!html.ok) assert.equal(html.error.code, 'malformed');

  const head = feed.slice(0, feed.indexOf(' <entry>'));
  const empty = await setup(t, {}, { status: 200, body: `${head}</feed>` }).read();
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.status, 'empty');
});
