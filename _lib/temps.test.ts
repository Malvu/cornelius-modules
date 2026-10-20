import assert from 'node:assert/strict';
import test from 'node:test';
import { dateIn, dayIn, iso, nextMidnight, nextWallTime, startOfDay, zonedTime } from './temps.js';

// Mardi 20 octobre 2026 ; passage à l'heure d'hiver à Paris le dimanche 25, à 3 h.
const at = (text: string) => Date.parse(text);

test('jour civil du foyer : la date change à minuit local, pas à minuit UTC', () => {
  assert.equal(dateIn(at('2026-10-20T21:59:00Z'), 'Europe/Paris'), '2026-10-20');
  assert.equal(dateIn(at('2026-10-20T22:00:00Z'), 'Europe/Paris'), '2026-10-21');
  assert.equal(dateIn(at('2026-10-20T20:00:00Z'), 'Indian/Reunion'), '2026-10-21');
  assert.equal(dayIn(at('2026-10-20T12:00:00Z'), 'UTC'), Date.UTC(2026, 9, 20) / 86_400_000);
});

test('heure murale vers UTC, changements d’heure compris', () => {
  const wall = (day: number, hour: number, minute = 0) => ({
    year: 2026,
    month: 10,
    day,
    hour,
    minute,
    second: 0,
  });
  assert.equal(iso(zonedTime(wall(24, 9), 'Europe/Paris')), '2026-10-24T07:00:00.000Z');
  assert.equal(iso(zonedTime(wall(26, 9), 'Europe/Paris')), '2026-10-26T08:00:00.000Z');
  // 2 h 30 existe deux fois le 25 : la première, encore à l'heure d'été.
  assert.equal(iso(zonedTime(wall(25, 2, 30), 'Europe/Paris')), '2026-10-25T00:30:00.000Z');
  // 2 h 30 n'existe pas le 29 mars 2026 : elle glisse après le saut.
  const spring = { year: 2026, month: 3, day: 29, hour: 2, minute: 30, second: 0 };
  assert.equal(iso(zonedTime(spring, 'Europe/Paris')), '2026-03-29T01:30:00.000Z');
});

test('prochaine heure donnée et minuit suivant, dans le fuseau', () => {
  const now = at('2026-10-20T08:00:00Z'); // 10 h à Paris
  assert.equal(iso(nextWallTime(now, 'Europe/Paris', 17)), '2026-10-20T15:00:00.000Z');
  assert.equal(iso(nextWallTime(now, 'Europe/Paris', 9)), '2026-10-21T07:00:00.000Z');
  assert.equal(iso(nextMidnight(now, 'Europe/Paris')), '2026-10-20T22:00:00.000Z');
  assert.equal(iso(nextMidnight(now, 'Indian/Reunion')), '2026-10-20T20:00:00.000Z');
  // Strictement après : à 17 h pile, le prochain 17 h est demain.
  assert.equal(
    iso(nextWallTime(at('2026-10-20T15:00:00Z'), 'Europe/Paris', 17)),
    '2026-10-21T15:00:00.000Z',
  );
  // Le samedi 24, minuit suivant est encore à l'heure d'été ; le dimanche 25, déjà en hiver.
  assert.equal(
    iso(nextMidnight(at('2026-10-25T10:00:00Z'), 'Europe/Paris')),
    '2026-10-25T23:00:00.000Z',
  );
  assert.equal(
    iso(startOfDay(Date.UTC(2026, 9, 26) / 86_400_000, 'Europe/Paris')),
    '2026-10-25T23:00:00.000Z',
  );
});
