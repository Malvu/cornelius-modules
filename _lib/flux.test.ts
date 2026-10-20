import assert from 'node:assert/strict';
import test from 'node:test';
import { ago, clip, FeedError, parseFeed, plainText } from './flux.js';

// Flux fictifs, au format exact des éditeurs : une ligne, entités hexadécimales (franceinfo),
// CDATA (Le Monde), HTML échappé dans le résumé, Atom de YouTube.
const rssHex =
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Les Titres</title>' +
  '<item><title>Qui est concern&#xE9;&#xA0;? Cinq questions sur la r&#xE9;forme</title>' +
  '<description>Les mesures s&#x2019;appliquent d&#xE8;s lundi.</description>' +
  '<pubDate>Tue, 20 Oct 2026 14:56:05 +0200</pubDate><link>https://exemple.fr/a.html#xtor=RSS-3</link>' +
  '<guid>https://exemple.fr/a.html</guid><enclosure length="243" type="image/jpeg" url="https://exemple.fr/a.jpg"/></item>' +
  '<item><title>Deuxi&#xE8;me titre</title><pubDate>Tue, 20 Oct 2026 13:52:45 +0200</pubDate></item>' +
  '</channel></rss>';

const rssCdata = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Le Journal - Actualités à la Une</title>
<item><title><![CDATA[EN DIRECT, la réforme : « une avancée » selon le ministre]]></title>
<pubDate>Tue, 20 Oct 2026 11:25:44 +0200</pubDate>
<description><![CDATA[<p>Un accord a été <b>trouvé</b> &amp; signé.</p>]]></description>
<link>https://journal.example/live.html</link></item>
<item><title>Sans date</title><description>&lt;p&gt;Résumé &lt;em&gt;échappé&lt;/em&gt;&lt;/p&gt;</description></item>
</channel></rss>`;

const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=UC0"/>
 <title>La Chaîne</title>
 <entry>
  <id>yt:video:abc</id>
  <title>Une vidéo &amp; un titre #diy</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=abc"/>
  <published>2026-10-09T17:06:23+00:00</published>
  <media:group><media:description>Le résumé.</media:description></media:group>
 </entry>
</feed>`;

test('RSS : entités hexadécimales, lien, date, résumé', () => {
  const feed = parseFeed(rssHex);
  assert.equal(feed.title, 'Les Titres');
  assert.equal(feed.items.length, 2);
  const [first] = feed.items;
  assert.equal(first!.title, 'Qui est concerné ? Cinq questions sur la réforme');
  assert.equal(first!.summary, 'Les mesures s’appliquent dès lundi.');
  assert.equal(first!.link, 'https://exemple.fr/a.html#xtor=RSS-3');
  assert.equal(first!.id, 'https://exemple.fr/a.html');
  assert.equal(first!.published, Date.parse('2026-10-20T12:56:05Z'));
  assert.match(first!.raw, /<enclosure/u);
});

test('RSS : CDATA et HTML, échappé ou non, rendus en texte', () => {
  const feed = parseFeed(rssCdata);
  assert.equal(feed.title, 'Le Journal - Actualités à la Une');
  assert.equal(feed.items[0]!.title, 'EN DIRECT, la réforme : « une avancée » selon le ministre');
  assert.equal(feed.items[0]!.summary, 'Un accord a été trouvé & signé.');
  assert.equal(feed.items[1]!.summary, 'Résumé échappé');
  assert.equal(feed.items[1]!.published, null);
});

test('Atom : titre, lien « alternate », date de publication, description média', () => {
  const feed = parseFeed(atom);
  assert.equal(feed.title, 'La Chaîne');
  assert.deepEqual(
    { ...feed.items[0], raw: undefined },
    {
      id: 'yt:video:abc',
      title: 'Une vidéo & un titre #diy',
      link: 'https://www.youtube.com/watch?v=abc',
      published: Date.parse('2026-10-09T17:06:23Z'),
      summary: 'Le résumé.',
      raw: undefined,
    },
  );
});

test('un flux coupé garde ses articles complets ; une page HTML est refusée', () => {
  const cut = rssHex.slice(0, rssHex.indexOf('<item><title>Deuxi') + 30);
  assert.equal(parseFeed(cut).items.length, 1);
  assert.throws(() => parseFeed('<!DOCTYPE html><html><body>Erreur</body></html>'), FeedError);
  assert.equal(plainText('a&nbsp;&nbsp;b &#128512; &bogus;'), 'a b 😀 &bogus;');
});

test('coupe sur un mot et dit l’ancienneté', () => {
  assert.equal(
    clip('Un titre assez long pour être coupé proprement', 25),
    'Un titre assez long pour…',
  );
  assert.equal(clip('Court', 25), 'Court');
  const now = Date.parse('2026-10-20T12:00:00Z');
  assert.equal(ago(now - 30_000, now), 'à l’instant');
  assert.equal(ago(now - 25 * 60_000, now), 'il y a 25 minutes');
  assert.equal(ago(now - 3 * 3_600_000, now), 'il y a 3 heures');
  assert.equal(ago(now - 26 * 3_600_000, now), 'hier');
  assert.equal(ago(now - 11 * 86_400_000, now), 'il y a 2 semaines');
  assert.equal(ago(now - 48 * 86_400_000, now), 'il y a 7 semaines');
  assert.equal(ago(now - 100 * 86_400_000, now), 'il y a 3 mois');
  assert.equal(ago(now - 800 * 86_400_000, now), 'il y a 2 ans');
});
