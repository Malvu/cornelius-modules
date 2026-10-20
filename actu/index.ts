/** Titres de l'actualité : les premiers titres d'un flux RSS ou Atom choisi. */
import { AddonCollectError, type AddonDefinition } from '#cornelius/addons';
import { ago, clip, FeedError, parseFeed } from '../_lib/flux.js';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type ActuConfig = { url: string; count: number };
type Headline = { title: string; published: string | null; summary: string | null };
type ActuData = { feed: string; items: Headline[] };

/** Nom court du journal : « Le Monde.fr - Actualités et Infos… » devient « Le Monde.fr ». */
function feedName(title: string | null, url: string): string {
  const name = title?.split(/\s+[-–|:]\s+/u)[0]?.trim();
  return (name || new URL(url).hostname.replace(/^www\./u, '')).slice(0, 120);
}

/** À l'oral, un titre finit par un point, sans en doubler un. */
function spoken(title: string): string {
  return /[.!?…»]$/u.test(title) ? title : `${title}.`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const addon: AddonDefinition<ActuConfig, ActuData> = {
  id: 'actu',
  apiVersion: 1,
  version: '1.1.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'Titres de l’actualité',
  display: {
    name: 'Titres de l’actualité',
    description: 'Les premiers titres d’un journal, d’après son flux RSS ou Atom.',
    icon: 'newspaper',
    keywords: ['actualité', 'actu', 'nouvelles', 'titres', 'journal', 'rss', 'infos'],
    example: { label: 'Les titres', ref: 'titres' },
    spoken: { head: 'les titres', repeats: ['titres', 'actu', 'actualite', 'infos'] },
  },
  configVersion: 1,
  configSchema,
  configDefaults: { url: 'https://www.franceinfo.fr/titres.rss', count: 3 },
  dataVersion: 1,
  dataSchema,
  freshMs: 15 * 60 * 1000,
  tools: [
    {
      name: 'read',
      description:
        'Lire les premiers titres de l’actualité du journal configuré et afficher leur carte. ' +
        'Utiliser pour « quelles sont les nouvelles ? » ou « les titres du jour ». ' +
        'Ne donne que les titres : pour approfondir un sujet, utiliser la recherche web.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
    },
  ],
  async collect(context) {
    const { url, count } = context.config;
    const response = await context.http.fetch({
      url,
      method: 'GET',
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
      signal: context.signal,
      timeoutMs: 6000,
      maxBytes: 512 * 1024,
    });
    if (response.status === 404 || response.status === 410)
      throw new AddonCollectError('not_found', 'Flux introuvable : vérifier son adresse.');
    if (response.status === 401 || response.status === 403)
      throw new AddonCollectError('forbidden', 'Le journal refuse l’accès à ce flux.');
    if (response.status === 429)
      throw new AddonCollectError(
        'quota',
        'Le journal limite les demandes, réessayer plus tard.',
        true,
      );
    if (response.status >= 500)
      throw new AddonCollectError('unavailable', 'Le journal ne répond pas.', true);
    if (response.status !== 200)
      throw new AddonCollectError('upstream', `Flux : réponse HTTP ${response.status} inattendue.`);
    let feed;
    try {
      feed = parseFeed(response.text());
    } catch (error) {
      if (error instanceof FeedError)
        throw new AddonCollectError('malformed', 'Cette adresse ne donne pas un flux RSS ou Atom.');
      throw error;
    }
    const items: Headline[] = feed.items.slice(0, count).map((item) => ({
      title: clip(item.title, 200),
      published: item.published === null ? null : new Date(item.published).toISOString(),
      summary: item.summary ? clip(item.summary, 300) : null,
    }));
    return {
      data: { feed: feedName(feed.title, url), items },
      empty: items.length === 0,
      source: { provider: new URL(url).hostname, sourceId: url.slice(0, 128) },
    };
  },
  ambient: {
    present(snapshot) {
      const data = snapshot.data;
      if (!data?.items.length) throw new Error('Aucun titre à afficher.');
      return {
        layout: 'list',
        title: clip(data.feed, 80),
        value: null,
        subtitle: null,
        items: data.items.slice(0, 3).map((item, index) => ({
          label: String(index + 1),
          value: clip(item.title, 160),
        })),
      };
    },
  },
  present(snapshot, context) {
    const data = snapshot.data;
    const first = data?.items[0];
    if (!data || !first) throw new Error('Aucun titre à présenter.');
    const now = context.now();
    const stale = snapshot.status === 'stale';
    return {
      title: clip(`Actu · ${data.feed}`, 80),
      primaryValue: clip(first.title, 120),
      subtitle: first.published ? capitalize(ago(Date.parse(first.published), now)) : null,
      description: stale ? 'Derniers titres connus : le journal ne répond pas.' : first.summary,
      items: data.items.slice(1, 5).map((item) => ({
        label: item.published ? capitalize(ago(Date.parse(item.published), now)) : 'À la une',
        value: clip(item.title, 160),
      })),
      summary:
        (stale ? 'Derniers titres connus, le journal ne répond pas. ' : '') +
        `Les titres de ${data.feed} : ${data.items.map((item) => spoken(item.title)).join(' ')}`,
      sources: ['actu'],
    };
  },
};

export default addon;
