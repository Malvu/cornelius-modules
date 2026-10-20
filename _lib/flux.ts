/**
 * Lecture des flux RSS 2.0 et Atom, sans dépendance, pour les modules de ce dépôt.
 * Ce dossier commence par « _ » : Cornelius ne le charge pas comme un module.
 *
 * Volontairement modeste : il lit les balises usuelles des flux d'actualité et de
 * YouTube, pas tout XML. Un flux coupé par la limite de taille du client garde ses
 * premiers articles complets ; un document qui n'est pas un flux est refusé.
 */

export interface FeedItem {
  id: string | null;
  title: string;
  link: string | null;
  /** Date de publication en millisecondes, null si absente ou illisible. */
  published: number | null;
  summary: string | null;
  /** Bloc XML brut de l'article, pour lire une balise propre au fournisseur. */
  raw: string;
}

export interface Feed {
  title: string | null;
  items: FeedItem[];
}

export class FeedError extends Error {}

const namedEntities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  ndash: '–',
  mdash: '—',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, code: string) => {
    if (code[0] === '#') {
      const value =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : match;
    }
    return namedEntities[code.toLowerCase()] ?? match;
  });
}

/**
 * Texte lisible d'un contenu XML : CDATA ouverts, balises HTML retirées, entités
 * décodées, espaces resserrés. Les espaces insécables deviennent des espaces simples.
 */
export function plainText(content: string): string {
  const unwrapped = content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1');
  // Le HTML d'un résumé arrive souvent échappé : on décode, puis on retire les balises.
  const decoded = decodeEntities(unwrapped.replace(/<[^>]*>/gu, ' '));
  return decoded
    .replace(/<[^>]*>/gu, ' ')
    .replace(/[\s ]+/gu, ' ')
    .trim();
}

const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** Contenu de la première balise `name` du bloc, ou null. */
export function tagContent(block: string, name: string): string | null {
  const pattern = new RegExp(`<${escape(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escape(name)}>`, 'u');
  return pattern.exec(block)?.[1] ?? null;
}

export function tagText(block: string, name: string): string | null {
  const content = tagContent(block, name);
  if (content === null) return null;
  const text = plainText(content);
  return text || null;
}

/** Valeur d'un attribut de la première balise `name` qui satisfait `where`. */
export function tagAttribute(
  block: string,
  name: string,
  attribute: string,
  where: (attributes: string) => boolean = () => true,
): string | null {
  const pattern = new RegExp(`<${escape(name)}(\\s[^>]*?)/?>`, 'gu');
  for (const match of block.matchAll(pattern)) {
    const attributes = match[1] ?? '';
    if (!where(attributes)) continue;
    const value = new RegExp(`\\s${escape(attribute)}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'u').exec(
      attributes,
    );
    if (value) return decodeEntities(value[2] ?? value[3] ?? '');
  }
  return null;
}

function blocks(xml: string, name: string): string[] {
  const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gu');
  return [...xml.matchAll(pattern)].map((match) => match[1] ?? '');
}

function date(text: string | null): number | null {
  if (!text) return null;
  const value = Date.parse(text.trim());
  return Number.isFinite(value) ? value : null;
}

/** Lit un flux RSS 2.0 ou Atom. Lève FeedError si le document n'en est pas un. */
export function parseFeed(xml: string): Feed {
  const head = xml.slice(0, 2048);
  const atom = /<feed[\s>]/u.test(head);
  const rss = /<(rss|rdf:RDF)[\s>]/u.test(head) || /<channel[\s>]/u.test(head);
  if (!atom && !rss) throw new FeedError('Ce document n’est pas un flux RSS ou Atom.');
  const marker = atom ? '<entry' : '<item';
  const firstItem = xml.indexOf(marker);
  const preamble = firstItem >= 0 ? xml.slice(0, firstItem) : xml;
  const title = tagText(preamble, 'title');
  const items: FeedItem[] = [];
  for (const raw of blocks(xml, atom ? 'entry' : 'item')) {
    const itemTitle = tagText(raw, 'title');
    if (!itemTitle) continue;
    const link = atom
      ? (tagAttribute(
          raw,
          'link',
          'href',
          (a) => !/\srel\s*=/u.test(a) || /rel\s*=\s*["']alternate/u.test(a),
        ) ?? tagAttribute(raw, 'link', 'href'))
      : tagText(raw, 'link');
    items.push({
      id: tagText(raw, atom ? 'id' : 'guid'),
      title: itemTitle,
      link,
      published: date(
        atom
          ? (tagText(raw, 'published') ?? tagText(raw, 'updated'))
          : (tagText(raw, 'pubDate') ?? tagText(raw, 'dc:date')),
      ),
      summary: atom
        ? (tagText(raw, 'summary') ?? tagText(raw, 'media:description') ?? tagText(raw, 'content'))
        : tagText(raw, 'description'),
      raw,
    });
  }
  return { title, items };
}

/** Coupe un texte à `max` caractères, sur un mot, avec une ellipse. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  // La coupe tombe déjà entre deux mots : rien à retirer.
  const space = /\s/u.test(text[cut.length] ?? '') ? cut.length : cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/u, '')}…`;
}

const relative = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

/** « il y a 3 heures », « hier », « il y a 2 semaines ». */
export function ago(published: number, now: number): string {
  const minutes = Math.round((published - now) / 60_000);
  if (minutes > -1) return 'à l’instant';
  if (minutes > -60) return relative.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours > -24) return relative.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (days > -7) return relative.format(days, 'day');
  const weeks = Math.round(days / 7);
  // En semaines jusqu'à deux mois : « il y a 7 semaines » est plus juste que « il y a 2 mois ».
  if (weeks > -9) return relative.format(weeks, 'week');
  const months = Math.round(days / 30.44);
  if (months > -12) return relative.format(months, 'month');
  return relative.format(Math.round(days / 365.25), 'year');
}
