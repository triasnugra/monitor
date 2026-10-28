/*
 * Penilaian dengan ATURAN MESIN 2: port setia dari tn/trade-sim.mjs (gradeTrade), yang dipakai
 * jurnal live Mesin 2 dan backtester-nya. Tujuannya agar angka monitor bisa direkonsiliasi
 * langsung dengan halaman /tn/. Logika walk()/gradeTrade TIDAK diubah; yang ditambah hanya
 * pencatatan waktu fill (fillT) dan adaptor ke provider candle monitor.
 *
 * Aturan (sama dengan trade-sim.mjs):
 *  1. Order limit terisi bila harga menyentuh entry (atau candle dibuka sudah di sisi menguntungkan -> isi di open).
 *  2. Candle pengisi BOLEH menyentuh SL -> dihitung SL. TP di candle pengisi hanya dihitung bila terisi tepat di open.
 *  3. SL dan TP dalam satu candle 1H: urutan ditentukan dari data 1 menit; tanpa data 1m -> SL dulu.
 *  4. Candle yang memuat waktu sinyal tidak dipakai utuh; hanya lewat 1m setelah waktu sinyal.
 *  5. Habis waktu (due): tidak terisi -> "tidak terisi" (0R); terisi -> "kedaluwarsa" (dinilai di close candle terakhir).
 *
 * PERBEDAAN PENTING vs aturan monitor (evaluate.js): di sini TP yang tersentuh SEBELUM entry TIDAK
 * mematikan setup. Order limit tetap ditunggu sampai due (default 7 hari), lalu bisa terisi dan kena SL.
 */
import { toIso } from '../util/time.js';

const H1 = 3_600_000;
const DAY = 86_400_000;

const rules = (r) => {
  const s = r.arah === 'LONG' ? 1 : -1;
  return {
    s,
    touch: (k) => (s === 1 ? k.l <= r.entry : k.h >= r.entry),
    open: (k) => (s === 1 ? k.o <= r.entry : k.o >= r.entry),
    sl: (k) => (s === 1 ? k.l <= r.sl : k.h >= r.sl),
    tp: (k) => (s === 1 ? k.h >= r.tp : k.l <= r.tp),
  };
};

// Jalankan daftar candle berurutan; ubah st.fill/st.fillT; kembalikan {res,t} saat SL/TP kena.
function walk(cs, P, st) {
  for (const k of cs) {
    if (!st.fill) {
      const ao = P.open(k);
      if (!ao && !P.touch(k)) continue;
      st.fill = true; st.fillT = k.ot;
      if (P.sl(k)) return { res: 'SL', t: k.ot };
      if (ao && P.tp(k)) return { res: 'TP', t: k.ot };
      continue;
    }
    if (P.sl(k)) return { res: 'SL', t: k.ot };
    if (P.tp(k)) return { res: 'TP', t: k.ot };
  }
  return null;
}

/**
 * Versi gradeTrade (trade-sim.mjs) dengan sumber candle diinjeksi.
 * r: { arah, entry, sl, tp, t, due }. src: { h1(), m1?(from,to), now }.
 * Kembalian: { hasil, R, t, fillT } atau null bila belum selesai.
 */
export async function gradeTrade(r, { h1, m1, now = Date.now() }) {
  const P = rules(r), risk = Math.abs(r.entry - r.sl), st = { fill: false, fillT: null };
  if (!(risk > 0)) return { hasil: 'tidak valid', R: 0, t: r.t, fillT: null };
  const done = (w) => ({ hasil: w.res, R: w.res === 'SL' ? -1 : (P.s * (r.tp - r.entry)) / risk, t: w.t, fillT: st.fillT });
  const cs = (await h1()).filter((k) => k.ct < now);

  if (cs.length && cs[0].ot < r.t) {
    const k0 = cs.shift();
    if (m1) {
      const ms = (await m1(Math.max(k0.ot, r.t), k0.ct)).filter((m) => m.ot >= r.t);
      const w = walk(ms, P, st);
      if (w) return done(w);
    }
  }

  let last = null;
  for (const k of cs) {
    if (k.ct > r.due) break;
    last = k;
    const amb = st.fill ? P.sl(k) && P.tp(k) : (P.touch(k) || P.open(k)) && (P.sl(k) || P.tp(k));
    const w = amb && m1 ? walk(await m1(k.ot, k.ct), P, st) : walk([k], P, st);
    if (w) return done(w);
  }

  if (now < r.due) return { pending: true, fillT: st.fillT };
  if (!st.fill) return { hasil: 'tidak terisi', R: 0, t: r.due, fillT: null };
  return { hasil: 'kedaluwarsa', R: (P.s * ((last ? last.c : r.entry) - r.entry)) / risk, t: r.due, fillT: st.fillT };
}

/**
 * Evaluasi satu setup monitor dengan aturan Mesin 2. Hasil dipetakan ke status monitor:
 *   TP, SL, PENDING, INVALID, EXPIRED + reasonCode NOT_FILLED ("tidak terisi") atau EXPIRED_FILLED ("kedaluwarsa").
 * Label asli Mesin 2 disimpan di `hasilMesin2` supaya mudah dicocokkan dengan jurnal /tn/.
 */
export async function evaluateMesin2Rules(setup, provider, { now = Date.now(), dueDays = 7 } = {}) {
  const base = { rule: 'mesin2', evaluatedAtUtc: toIso(now), entryTimeUtc: null, resultTimeUtc: null, resultTimeSource: null,
    rMultiple: null, markR: null, reasonCode: null, hasilMesin2: null, dueUtc: null, notes: [] };
  const out = (result, extra = {}) => ({ ...base, result, ...extra });

  if (setup.analysisTimeSource === 'unknown_before_tracking')
    return out('INVALID', { reasonCode: 'ANALYSIS_TIME_UNKNOWN', hasilMesin2: 'tidak valid', notes: ['Waktu analisis tidak diketahui; tidak dievaluasi.'] });
  const dir = setup.direction;
  const tp = Array.isArray(setup.takeProfit) ? setup.takeProfit[0] : setup.takeProfit;
  const entry = setup.entryPrice, sl = setup.stopLoss;
  const t = Date.parse(setup.analysisTimeUtc);
  if ((dir !== 'LONG' && dir !== 'SHORT') || ![entry, sl, tp, t].every(Number.isFinite) || !setup.symbol)
    return out('INVALID', { reasonCode: 'MISSING_FIELDS', hasilMesin2: 'tidak valid', notes: ['Arah/level/simbol/waktu tidak lengkap.'] });
  const sgn = dir === 'LONG' ? 1 : -1;
  if (!(sgn * (entry - sl) > 0 && sgn * (tp - entry) > 0))
    return out('INVALID', { reasonCode: `LEVELS_INCONSISTENT_WITH_${dir}`, hasilMesin2: 'tidak valid', notes: ['Level tidak konsisten dengan arah.'] });

  const rawDue = Number(setup.rawData?.due);
  const due = setup.engine === 'tn' && Number.isFinite(rawDue) ? rawDue : t + dueDays * DAY; // tn: due dari sumber
  const t0 = Math.floor(t / H1) * H1;
  const sym = setup.symbol;
  const mapK = (c) => ({ ot: c.t, o: c.o, h: c.h, l: c.l, c: c.c, ct: c.closeT });
  const g = await gradeTrade({ arah: dir, entry, sl, tp, t, due }, {
    now,
    // Hanya candle sampai due yang dipakai (gradeTrade berhenti di k.ct > due), jadi tidak perlu mengambil lebih.
    h1: async () => (await provider.getCandles(sym, '1h', t0, Math.min(now, due + H1))).map(mapK),
    m1: async (a, b) => (await provider.getCandles(sym, '1m', a, b + 1)).map(mapK),
  });
  const common = { dueUtc: toIso(due), entryTimeUtc: g.fillT != null ? toIso(g.fillT) : null };
  if (g.pending) {
    return out('PENDING', { ...common, reasonCode: g.fillT != null ? 'IN_TRADE' : 'WAITING_ENTRY', hasilMesin2: 'menunggu',
      notes: [g.fillT != null ? 'Entry terisi; menunggu TP/SL/due.' : 'Menunggu entry tersentuh.'] });
  }
  const res = { ...common, resultTimeUtc: toIso(g.t), hasilMesin2: g.hasil };
  if (g.hasil === 'TP' || g.hasil === 'SL')
    return out(g.hasil, { ...res, resultTimeSource: 'candle', rMultiple: g.R,
      notes: ['Aturan Mesin 2: urutan SL/TP diselesaikan dengan data 1 menit bila ambigu.'] });
  if (g.hasil === 'tidak terisi')
    return out('EXPIRED', { ...res, resultTimeSource: 'timeout', reasonCode: 'NOT_FILLED', notes: ['Habis waktu tanpa entry tersentuh (0R).'] });
  if (g.hasil === 'kedaluwarsa')
    return out('EXPIRED', { ...res, resultTimeSource: 'timeout', reasonCode: 'EXPIRED_FILLED', markR: g.R,
      notes: ['Terisi tetapi TP/SL tidak tercapai sebelum due; dinilai di close candle terakhir (tidak dihitung menang/kalah).'] });
  return out('INVALID', { ...res, reasonCode: 'ZERO_RISK', notes: ['Jarak entry-SL nol.'] });
}

/** Kategori halus untuk pencocokan dengan label jurnal /tn/. */
export const m2Category = (ev) => (!ev ? null : ev.result === 'EXPIRED' ? ev.reasonCode : ev.result);
export const SOURCE_CATEGORY = { TP: 'TP', SL: 'SL', menunggu: 'PENDING', kedaluwarsa: 'EXPIRED_FILLED', 'tidak terisi': 'NOT_FILLED', 'tidak valid': 'INVALID' };
