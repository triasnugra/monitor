import test from 'node:test'; import assert from 'node:assert/strict';
import { upsertSetups } from '../src/storage/store.js';
import { parseJournalEntry } from '../src/parsers/tn.js';
import { buildRecord } from '../src/normalize.js';

const entry = (o = {}) => ({ id: '2026-10-04|Aturan Eliz|LINK', waktu: '2026-10-04 06:47 UTC', t: Date.parse('2026-10-04T06:47:49.960Z'),
  due: Date.parse('2026-10-11T06:47:49.960Z'), aset: 'LINK', arah: 'SHORT', entry: 14.017, sl: 15.856, tp: 10.339,
  alasan: 'x', hasil: 'menunggu', R: '', h: 'abc123', ...o });
const rec = (e) => buildRecord(parseJournalEntry(e), { scanTimeMs: Date.parse('2026-10-16T00:00:00Z'), firstRun: false, sourceUrl: 'u' });

test('sourceResult/sourceR/sourceExitUtc disegarkan saat setup terlihat lagi; originalStatus tetap status pertama', () => {
  const t1 = '2026-10-16T00:00:00.000Z', t2 = '2026-10-18T00:00:00.000Z', t3 = '2026-10-19T00:00:00.000Z';
  let { setups } = upsertSetups([], [rec(entry())], t1, []);
  assert.equal(setups[0].sourceResult, 'menunggu'); assert.equal(setups[0].originalStatus, 'menunggu');
  ({ setups } = upsertSetups(setups, [rec(entry({ hasil: 'SL', R: -1, tx: Date.parse('2026-10-17T10:00:00Z') }))], t2, []));
  const s = setups[0];
  assert.equal(s.sourceResult, 'SL'); assert.equal(s.sourceR, -1);
  assert.equal(s.sourceExitUtc, '2026-10-17T10:00:00.000Z');
  assert.equal(s.sourceResultChangedUtc, t2); assert.equal(s.sourceCheckedUtc, t2);
  assert.equal(s.originalStatus, 'menunggu');       // status saat pertama terlihat tidak diubah
  assert.equal(s.latestOriginalStatus, 'SL');
  assert.equal(s.seenCount, 2); assert.equal(setups.length, 1);
  ({ setups } = upsertSetups(setups, [rec(entry({ hasil: 'SL', R: -1, tx: Date.parse('2026-10-17T10:00:00Z') }))], t3, []));
  assert.equal(setups[0].sourceResultChangedUtc, t2); // tidak berubah -> penanda perubahan tidak digeser
  assert.equal(setups[0].sourceCheckedUtc, t3);
});

test('setup yang tidak muncul di scan tidak dihapus dan field sumbernya tidak disentuh', () => {
  let { setups } = upsertSetups([], [rec(entry({ hasil: 'TP', R: 2 }))], '2026-10-16T00:00:00.000Z', []);
  ({ setups } = upsertSetups(setups, [], '2026-10-17T00:00:00.000Z', []));
  assert.equal(setups.length, 1); assert.equal(setups[0].sourceResult, 'TP');
});
