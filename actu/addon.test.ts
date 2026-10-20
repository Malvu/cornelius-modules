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

// Flux fictifs, aux formats exacts de franceinfo (entités hexadécimales) et du Monde (CDATA).
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

function setup(
  t: { after(fn: () => void): void },
  config: Record<string, unknown> = {},
  reply: { status: number; body: string } = { status: 200, body: fixture('franceinfo.xml') },
) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const instances = new AddonRepository(db);
  const instance = instances.createInstance({
    addonId: addon.id,
    profileId: null,
    ref: 'titres',
    label: 'Les titres',
    config: { ...addon.configDefaults, ...config },
    configVersion: addon.configVersion,
  });
  let now = Date.parse('2026-10-20T13:30:00Z');
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
    instance,
    calls,
    read: () => runtime.read(addon.id, null, 'titres', new AbortController().signal),
    advance: (ms: number) => {
      now += ms;
    },
    reply: (next: { status: number; body: string }) => {
      current = next;
    },
  };
}

test('définition v1, configuration, snapshot, carte et résultat outil conformes', async (t) => {
  const f = setup(t);
  assert.equal(validateAddonDefinition(addon), null);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  for (const url of ['ftp://exemple.fr/flux', 'franceinfo.fr/titres.rss', 'javascript:alert(1)'])
    assert.equal(f.runtime.validateConfig(addon.id, { url, count: 3 }).ok, false, url);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(validators.moduleSnapshot(result.snapshot), true);
  assert.equal(validators.moduleCard(result.card), true);
  assert.equal(validators.ambientPresentation(f.runtime.ambientDisplay(f.instance).content), true);
  assert.equal(validators.toolResult(f.runtime.toolResult(result)), true);
  assert.equal(f.calls[0]?.url, 'https://www.franceinfo.fr/titres.rss');
  assert.match(f.calls[0]?.headers?.['User-Agent'] ?? '', /^Cornelius-modules\//u);
});

test('franceinfo : entités décodées, ancienneté, nombre de titres réglé', async (t) => {
  const f = setup(t);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.title, 'Actu · franceinfo');
  assert.equal(
    result.card.primaryValue,
    'Titre fictif : la météo se dégrade sur la façade atlantique',
  );
  assert.equal(result.card.subtitle, 'Il y a 34 minutes');
  assert.equal(result.card.description, 'Un texte fictif d’essai, au format du flux.');
  assert.deepEqual(result.card.items, [
    // 1 h 38 et 4 h 25 plus tôt, arrondis à l'heure.
    { label: 'Il y a 2 heures', value: 'Deuxième titre fictif, publié une heure plus tôt' },
    { label: 'Il y a 4 heures', value: 'Troisième titre fictif' },
  ]);
  assert.equal(
    result.presentation.summary,
    'Les titres de franceinfo : Titre fictif : la météo se dégrade sur la façade atlantique. ' +
      'Deuxième titre fictif, publié une heure plus tôt. Troisième titre fictif.',
  );
});

test('Le Monde : CDATA, nom court du journal, ordre de la rédaction gardé', async (t) => {
  const f = setup(
    t,
    { url: 'https://www.lemonde.fr/rss/une.xml', count: 5 },
    { status: 200, body: fixture('lemonde.xml') },
  );
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.title, 'Actu · Le Monde.fr');
  assert.equal(
    result.card.primaryValue,
    'Titre fictif en direct : « une journée d’essai » pour le module',
  );
  assert.equal(
    result.card.items[0]?.value,
    'Un titre fictif plus récent, placé en second par la rédaction',
  );
  assert.match(result.presentation.summary, /pour le module. Un titre fictif plus récent/u);
});

test('panne après expiration : derniers titres connus, annoncés comme tels', async (t) => {
  const f = setup(t);
  assert.equal((await f.read()).ok, true);
  f.advance(15 * 60 * 1000 + 1);
  f.reply({ status: 503, body: '' });
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stale, true);
  assert.match(result.presentation.summary, /^Derniers titres connus, le journal ne répond pas\./u);
  assert.equal(result.card.description, 'Derniers titres connus : le journal ne répond pas.');
});

test('adresse qui ne donne pas un flux, flux absent ou vide', async (t) => {
  const page = await setup(t, {}, { status: 200, body: '<!DOCTYPE html><html></html>' }).read();
  assert.equal(page.ok, false);
  if (!page.ok) {
    assert.equal(page.error.code, 'malformed');
    assert.equal(page.error.message, 'Cette adresse ne donne pas un flux RSS ou Atom.');
  }
  const missing = await setup(t, {}, { status: 404, body: '' }).read();
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, 'not_found');
  const empty = await setup(
    t,
    {},
    { status: 200, body: '<rss><channel><title>Vide</title></channel></rss>' },
  ).read();
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.status, 'empty');
});
