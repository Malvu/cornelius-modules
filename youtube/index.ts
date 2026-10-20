/** YouTube : la dernière vidéo d'une chaîne, par son flux public, sans jeton. */
import { AddonCollectError, type AddonDefinition } from '#cornelius/addons';
import { ago, clip, FeedError, parseFeed, tagAttribute, tagText } from '../_lib/flux.js';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type YoutubeConfig = { channelId: string; shorts: boolean };
type Video = { id: string; title: string; published: string; short: boolean; views: number | null };
type YoutubeData = { channel: string; videos: Video[] };

const feedUrl = 'https://www.youtube.com/feeds/videos.xml';
const views = new Intl.NumberFormat('fr-FR');

/** Les mots-clés de fin (« #diy #impression3d ») ne se lisent pas. */
function cleanTitle(title: string): string {
  return title.replace(/(\s+#[\p{L}\p{N}_]+)+\s*$/u, '').trim() || title.trim();
}

/** À l'oral, ni émoji ni mention « @chaîne ». */
function spokenTitle(title: string): string {
  return cleanTitle(title)
    .replace(/[\p{Extended_Pictographic}️‍]/gu, '')
    .replace(/\s@\S+/gu, '')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const addon: AddonDefinition<YoutubeConfig, YoutubeData> = {
  id: 'youtube',
  apiVersion: 1,
  version: '1.1.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'YouTube',
  display: {
    name: 'YouTube',
    description: 'La dernière vidéo d’une chaîne, par défaut celle des Frères Poulain.',
    icon: 'play',
    keywords: ['youtube', 'vidéo', 'chaîne', 'frères poulain', 'shorts'],
    example: { label: 'Les Frères Poulain', ref: 'freres-poulain' },
    spoken: { head: 'les vidéos', repeats: ['youtube', 'videos', 'video', 'chaine'] },
  },
  configVersion: 1,
  configSchema,
  configDefaults: { channelId: 'UCjED9uS41ioeFuPfbR-OBlw', shorts: false },
  dataVersion: 1,
  dataSchema,
  freshMs: 30 * 60 * 1000,
  tools: [
    {
      name: 'read',
      description:
        'Lire la dernière vidéo publiée sur la chaîne YouTube configurée et afficher sa carte. ' +
        'Utiliser pour « il y a une nouvelle vidéo ? » ou « c’est quoi leur dernière vidéo ? ».',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
    },
  ],
  async collect(context) {
    const { channelId, shorts } = context.config;
    const response = await context.http.fetch({
      url: `${feedUrl}?channel_id=${encodeURIComponent(channelId)}`,
      method: 'GET',
      signal: context.signal,
      timeoutMs: 6000,
      maxBytes: 256 * 1024,
    });
    if (response.status === 404)
      throw new AddonCollectError('not_found', 'Chaîne introuvable : vérifier son identifiant.');
    if (response.status === 429)
      throw new AddonCollectError(
        'quota',
        'YouTube limite les demandes, réessayer plus tard.',
        true,
      );
    if (response.status >= 500)
      throw new AddonCollectError('unavailable', 'YouTube ne répond pas.', true);
    if (response.status !== 200)
      throw new AddonCollectError(
        'upstream',
        `YouTube : réponse HTTP ${response.status} inattendue.`,
      );
    let feed;
    try {
      feed = parseFeed(response.text());
    } catch (error) {
      if (error instanceof FeedError)
        throw new AddonCollectError('malformed', 'YouTube : flux de la chaîne illisible.');
      throw error;
    }
    const videos: Video[] = [];
    for (const item of feed.items) {
      const id = tagText(item.raw, 'yt:videoId');
      if (!id || !/^[A-Za-z0-9_-]{11}$/u.test(id) || item.published === null) continue;
      const short = /\/shorts\//u.test(item.link ?? '');
      if (short && !shorts) continue;
      const count = Number(tagAttribute(item.raw, 'media:statistics', 'views'));
      videos.push({
        id,
        title: item.title.slice(0, 200),
        published: new Date(item.published).toISOString(),
        short,
        views: Number.isInteger(count) && count >= 0 ? count : null,
      });
    }
    videos.sort((a, b) => (a.published < b.published ? 1 : -1));
    const channel = (tagText(feed.items[0]?.raw ?? '', 'name') ?? feed.title ?? 'YouTube').slice(
      0,
      120,
    );
    return {
      data: { channel, videos: videos.slice(0, 5) },
      empty: videos.length === 0,
      source: { provider: 'youtube', sourceId: channelId },
    };
  },
  ambient: {
    present(snapshot, context) {
      const data = snapshot.data;
      const latest = data?.videos[0];
      if (!data || !latest) throw new Error('Aucune vidéo à afficher.');
      return {
        layout: 'metric',
        title: 'YouTube',
        value: clip(cleanTitle(latest.title), 120),
        subtitle: clip(
          `${data.channel} · ${ago(Date.parse(latest.published), context.now())}`,
          120,
        ),
        items: [],
      };
    },
  },
  present(snapshot, context) {
    const data = snapshot.data;
    const latest = data?.videos[0];
    if (!data || !latest) throw new Error('Aucune vidéo à présenter.');
    const now = context.now();
    const stale = snapshot.status === 'stale';
    const when = ago(Date.parse(latest.published), now);
    const items = data.videos.slice(1, 4).map((video) => ({
      label: capitalize(ago(Date.parse(video.published), now)),
      value: clip(cleanTitle(video.title), 160),
    }));
    if (latest.views !== null) items.unshift({ label: 'Vues', value: views.format(latest.views) });
    return {
      title: clip(`YouTube · ${data.channel}`, 80),
      primaryValue: clip(cleanTitle(latest.title), 120),
      subtitle: `${latest.short ? 'Short publié' : 'Publiée'} ${when}`,
      description: stale ? 'Dernière liste connue : une vidéo plus récente a pu sortir.' : null,
      items: items.slice(0, 5),
      summary:
        (stale ? 'D’après la dernière liste connue, à vérifier. ' : '') +
        `Dernière vidéo de la chaîne ${data.channel}, publiée ${when} : « ${spokenTitle(latest.title)} ».`,
      sources: ['youtube'],
    };
  },
};

export default addon;
