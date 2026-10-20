/** Poubelles : quel bac sortir, d'après le calendrier de ramassage écrit en toutes lettres. */
import { AddonCollectError, type AddonDefinition } from '#cornelius/addons';
import { dayIn, dayMs, iso, nextMidnight, nextWallTime, wallIn } from '../_lib/temps.js';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type Kind = 'menager' | 'emballages' | 'verre' | 'biodechets' | 'vegetaux' | 'encombrants';
type PoubellesConfig = { bacs: { bac: Kind; jours: string }[]; veille: boolean };
type Rule = { weekdays: number[]; parity: 'all' | 'even' | 'odd'; ordinals: number[] };
type Bin = Rule & { kind: Kind };
type PoubellesData = { bins: Bin[]; veille: boolean };

const kinds: Kind[] = ['menager', 'emballages', 'verre', 'biodechets', 'vegetaux', 'encombrants'];

/** Libellé de carte, et ce qu'on « sort » à l'oral. */
const names: Record<Kind, { label: string; spoken: string }> = {
  menager: { label: 'Ordures ménagères', spoken: 'les ordures ménagères' },
  emballages: { label: 'Emballages', spoken: 'les emballages' },
  verre: { label: 'Verre', spoken: 'le verre' },
  biodechets: { label: 'Biodéchets', spoken: 'les biodéchets' },
  vegetaux: { label: 'Déchets verts', spoken: 'les déchets verts' },
  encombrants: { label: 'Encombrants', spoken: 'les encombrants' },
};

/** Réglages de la version 1 (un champ par bac) vers la liste de la version 2. */
function migrate(fromVersion: number, config: unknown): PoubellesConfig {
  if (fromVersion !== 1 || !config || typeof config !== 'object')
    throw new Error(`Réglages poubelles v${fromVersion} inconnus.`);
  const old = config as Record<string, unknown>;
  const bacs = (['menager', 'emballages', 'verre', 'biodechets', 'vegetaux'] as const)
    .filter((kind) => typeof old[kind] === 'string' && (old[kind] as string).trim())
    .map((kind) => ({ bac: kind, jours: (old[kind] as string).trim() }));
  return { bacs, veille: old.veille !== false };
}

// --- Lecture des règles en toutes lettres -----------------------------------------------------

const weekdayWords: Record<string, number> = {
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
  dimanche: 7,
};
const ordinalWords: Record<string, number> = {
  '1er': 1,
  '1re': 1,
  premier: 1,
  premiere: 1,
  '2e': 2,
  '2eme': 2,
  deuxieme: 2,
  second: 2,
  seconde: 2,
  '3e': 3,
  '3eme': 3,
  troisieme: 3,
  '4e': 4,
  '4eme': 4,
  quatrieme: 4,
  '5e': 5,
  '5eme': 5,
  cinquieme: 5,
  dernier: -1,
  derniere: -1,
};
/** Mots de liaison acceptés sans effet : « le », « et », « du mois », « chaque »… */
const fillers = new Set([
  'le',
  'les',
  'la',
  'et',
  'du',
  'de',
  'des',
  'au',
  'mois',
  'semaine',
  'semaines',
  'chaque',
  'tous',
  'toutes',
  'tout',
  'matin',
  'matins',
]);

/** Minuscules sans accents ni pluriel : « Lundis » donne « lundi », « mois » donne « moi ». */
function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[,;/+]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => word.replace(/s$/u, '') || word);
}

/**
 * « lundi et jeudi », « mardi semaines paires », « 1er et 3e mercredi du mois »,
 * « dernier vendredi du mois ». Un mot inconnu est refusé plutôt que deviné.
 */
export function parseRule(text: string): Rule {
  const weekdays = new Set<number>();
  const ordinals = new Set<number>();
  let parity: Rule['parity'] = 'all';
  for (const word of normalize(text)) {
    if (word in weekdayWords) weekdays.add(weekdayWords[word]!);
    else if (word in ordinalWords) ordinals.add(ordinalWords[word]!);
    else if (word === 'pair' || word === 'paire') parity = 'even';
    else if (word === 'impair' || word === 'impaire') parity = 'odd';
    else if (!fillers.has(word) && !fillers.has(`${word}s`))
      throw new Error(`« ${word} » n’est pas compris`);
  }
  if (weekdays.size === 0) throw new Error('aucun jour de la semaine');
  if (ordinals.size > 0 && parity !== 'all')
    throw new Error('choisir entre « semaines paires » et « du mois »');
  return {
    weekdays: [...weekdays].sort((a, b) => a - b),
    parity,
    ordinals: [...ordinals].sort((a, b) => a - b),
  };
}

// --- Calendrier ------------------------------------------------------------------------------

const longDay = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

function weekday(day: number): number {
  return ((new Date(day * dayMs).getUTCDay() + 6) % 7) + 1;
}

/** Numéro de semaine ISO 8601, celui des calendriers « semaines paires ». */
function isoWeek(day: number): number {
  const thursday = day - weekday(day) + 4;
  const date = new Date(thursday * dayMs);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1) / dayMs;
  return Math.floor((thursday - yearStart) / 7) + 1;
}

function matches(rule: Rule, day: number): boolean {
  if (!rule.weekdays.includes(weekday(day))) return false;
  if (rule.parity !== 'all' && (isoWeek(day) % 2 === 0) !== (rule.parity === 'even')) return false;
  if (rule.ordinals.length === 0) return true;
  const date = new Date(day * dayMs);
  const rank = Math.ceil(date.getUTCDate() / 7);
  const last = new Date((day + 7) * dayMs).getUTCMonth() !== date.getUTCMonth();
  return rule.ordinals.includes(rank) || (last && rule.ordinals.includes(-1));
}

function nextDay(rule: Rule, from: number): number | null {
  for (let day = from; day < from + 70; day += 1) if (matches(rule, day)) return day;
  return null;
}

function spokenDay(day: number): string {
  return longDay.format(new Date(day * dayMs)).replace(/ 1 /u, ' 1er ');
}

/**
 * Le ramassage du jour compte jusqu'à midi ; après, on regarde le suivant. Avec la
 * veille au soir, un ramassage du lendemain s'annonce dès 17 h. Un bac décrit sur plusieurs
 * lignes (deux rythmes) ne compte qu'une fois, à sa date la plus proche. Heures du foyer.
 */
function schedule(data: PoubellesData, now: number, zone: string) {
  const today = dayIn(now, zone);
  const hour = wallIn(now, zone).hour;
  const from = hour < 12 ? today : today + 1;
  const byKind = new Map<Kind, { bin: Bin; day: number }>();
  for (const bin of data.bins) {
    const day = nextDay(bin, from);
    const known = byKind.get(bin.kind);
    if (day !== null && (!known || day < known.day)) byKind.set(bin.kind, { bin, day });
  }
  const upcoming = [...byKind.values()].sort(
    (a, b) => a.day - b.day || kinds.indexOf(a.bin.kind) - kinds.indexOf(b.bin.kind),
  );
  const first = upcoming[0]?.day ?? null;
  const next = upcoming.filter((entry) => entry.day === first);
  const tonight = data.veille && first === today + 1 && hour >= 17;
  return { today, upcoming, next, first, tonight };
}

function when(day: number, today: number): string {
  if (day === today) return 'aujourd’hui';
  if (day === today + 1) return 'demain';
  return spokenDay(day);
}

function joinSpoken(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} et ${items.at(-1)}`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** La carte permanente change à midi (fin du ramassage du jour), à 17 h et à minuit. */
function nextChange(now: number, zone: string, veille: boolean): string {
  return iso(
    Math.min(
      nextWallTime(now, zone, 12),
      ...(veille ? [nextWallTime(now, zone, 17)] : []),
      nextMidnight(now, zone),
    ),
  );
}

const addon: AddonDefinition<PoubellesConfig, PoubellesData> = {
  id: 'poubelles',
  apiVersion: 1,
  version: '1.1.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'Ramassage des poubelles',
  display: {
    name: 'Poubelles',
    description: 'Quel bac sortir et quand, d’après le calendrier de ramassage de la commune.',
    icon: 'trash-2',
    keywords: ['poubelles', 'déchets', 'ramassage', 'collecte', 'tri', 'verre', 'emballages'],
    example: { label: 'Poubelles de la maison', ref: 'maison' },
    spoken: { head: 'les poubelles', repeats: ['poubelles', 'poubelle', 'dechets', 'ramassage'] },
  },
  configVersion: 2,
  configSchema,
  configMigrate: migrate,
  configDefaults: {
    bacs: [
      { bac: 'menager', jours: 'lundi et jeudi' },
      { bac: 'emballages', jours: 'mercredi semaines paires' },
    ],
    veille: true,
  },
  dataVersion: 1,
  dataSchema,
  // Aucun réseau : le calendrier ne change qu'avec les réglages, la date est recalculée.
  freshMs: 24 * 60 * 60 * 1000,
  tools: [
    {
      name: 'read',
      description:
        'Lire le prochain ramassage des poubelles et afficher sa carte. Utiliser pour ' +
        '« quelle poubelle je sors ce soir ? », « c’est quand le verre ? » ou ' +
        '« on sort les poubelles demain ? ».',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
    },
  ],
  async collect(context) {
    const bins: Bin[] = [];
    for (const { bac: kind, jours } of context.config.bacs) {
      const text = jours.trim();
      if (!text) continue;
      try {
        bins.push({ kind, ...parseRule(text) });
      } catch (error) {
        throw new AddonCollectError(
          'config_invalid',
          `${names[kind].label} : ${(error as Error).message}. Écrire par exemple « lundi et jeudi », ` +
            '« mardi semaines paires » ou « 1er vendredi du mois ».',
        );
      }
    }
    if (bins.length === 0)
      throw new AddonCollectError('config_invalid', 'Aucun jour de ramassage renseigné.');
    return {
      data: { bins, veille: context.config.veille },
      // Calcul local : la « source » est le calendrier saisi dans la source elle-même.
      source: { provider: 'local-calendar', sourceId: context.instance.ref ?? context.instance.id },
    };
  },
  ambient: {
    present(snapshot, context) {
      const data = snapshot.data;
      if (!data) throw new Error('Aucun calendrier à afficher.');
      const { today, upcoming, next, first, tonight } = schedule(
        data,
        context.now(),
        context.timeZone,
      );
      const later = upcoming.filter((entry) => entry.day !== first).slice(0, 2);
      return {
        layout: 'metric',
        showCollectedAt: false,
        title: 'Poubelles',
        value: first === null ? null : tonight ? 'Ce soir' : capitalize(when(first, today)),
        subtitle: next.length ? next.map((entry) => names[entry.bin.kind].label).join(' · ') : null,
        items: later.map((entry) => ({
          label: names[entry.bin.kind].label,
          value: capitalize(when(entry.day, today)),
        })),
        refreshAt: nextChange(context.now(), context.timeZone, data.veille),
      };
    },
  },
  present(snapshot, context) {
    const data = snapshot.data;
    if (!data) throw new Error('Aucun calendrier à présenter.');
    const { today, upcoming, next, first, tonight } = schedule(
      data,
      context.now(),
      context.timeZone,
    );
    const spoken = joinSpoken(next.map((entry) => names[entry.bin.kind].spoken));
    let summary: string;
    let primaryValue: string | null;
    if (first === null) {
      primaryValue = null;
      summary = 'Aucun ramassage prévu dans les dix semaines qui viennent.';
    } else if (tonight) {
      primaryValue = 'Ce soir';
      summary = `Ce soir, on sort ${spoken} : ramassage demain matin.`;
    } else if (first === today) {
      primaryValue = 'Aujourd’hui';
      summary = `Ramassage aujourd’hui : ${spoken}.`;
    } else {
      primaryValue = capitalize(when(first, today));
      summary = `Prochain ramassage ${when(first, today)} : ${spoken}.`;
    }
    const others = upcoming.filter((entry) => entry.day !== first).slice(0, 4);
    if (others.length)
      summary +=
        ' Ensuite : ' +
        others
          .map((entry) => `${names[entry.bin.kind].spoken} ${when(entry.day, today)}`)
          .join(', ') +
        '.';
    return {
      title: 'Poubelles',
      primaryValue,
      subtitle: next.length ? next.map((entry) => names[entry.bin.kind].label).join(' · ') : null,
      description: first !== null && first > today + 1 ? `Le ${spokenDay(first)}.` : null,
      items: upcoming.slice(0, 5).map((entry) => ({
        label: names[entry.bin.kind].label,
        value: capitalize(when(entry.day, today)),
      })),
      summary,
      sources: ['poubelles'],
    };
  },
};

export default addon;
