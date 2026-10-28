import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || 'data';
const p = (...x) => path.join(DATA_DIR, ...x);

export function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
export const loadSetups = () => readJson(p('setups.json'), []);
export const saveSetups = (list) => writeJsonAtomic(p('setups.json'), list);
export const loadDiagnostics = () => readJson(p('diagnostics.json'), { runs: [] });
export function saveDiagnostics(d, keep = 200) {
  writeJsonAtomic(p('diagnostics.json'), { runs: d.runs.slice(-keep) });
}
export function appendAudit(entries) {
  if (!entries.length) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(p('audit.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}
export function saveRaw(engine, tsIso, payload, keep = 100) {
  const dir = p('raw', engine);
  writeJsonAtomic(path.join(dir, `${tsIso.replace(/[:.]/g, '-')}.json`), payload);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(dir, f));
}

/**
 * Upsert idempoten berdasarkan setupId. Tidak pernah menghapus setup lama.
 * Setup yang sudah ada diperbarui: lastSeen/seenCount/status asli terbaru, DAN hasil dari sumber
 * (sourceResult, sourceR, sourceExitUtc). Sebelumnya field sumber dibekukan saat pertama terlihat,
 * sehingga perbandingan sumber-vs-evaluasi memakai data basi. originalStatus tetap = status saat pertama terlihat.
 */
export function upsertSetups(existing, incoming, nowIso, cancelPatterns = []) {
  const byId = new Map(existing.map((s) => [s.setupId, s]));
  let added = 0, updated = 0;
  const re = cancelPatterns.length ? new RegExp(cancelPatterns.join('|'), 'i') : null;
  for (const s of incoming) {
    const cur = byId.get(s.setupId);
    if (!cur) {
      byId.set(s.setupId, { ...s, firstSeenUtc: nowIso, lastSeenUtc: nowIso, seenCount: 1,
        latestOriginalStatus: s.originalStatus,
        engineCancelledAtUtc: re && s.originalStatus && re.test(s.originalStatus) ? nowIso : null,
        evaluation: { result: 'PENDING', notes: ['Belum dievaluasi.'] } });
      added++;
    } else {
      cur.lastSeenUtc = nowIso; cur.seenCount += 1; cur.latestOriginalStatus = s.originalStatus;
      refreshSourceFields(cur, s, nowIso);
      if (!cur.engineCancelledAtUtc && re && s.originalStatus && re.test(s.originalStatus)) cur.engineCancelledAtUtc = nowIso;
      updated++;
    }
  }
  return { setups: [...byId.values()], added, updated };
}

/** Segarkan hasil dari sumber. Hanya menimpa bila sumber memang memberi nilai di scan ini. */
export function refreshSourceFields(cur, incoming, nowIso) {
  if (incoming.sourceResult === undefined) return false; // parser tidak menyediakan hasil sumber (mis. Mesin 1)
  const next = incoming.sourceResult ?? null;
  const changed = (cur.sourceResult ?? null) !== next;
  if (changed) cur.sourceResultChangedUtc = nowIso;
  cur.sourceResult = next;
  cur.sourceR = incoming.sourceR ?? null;
  cur.sourceExitUtc = incoming.sourceExitUtc ?? null;
  cur.sourceCheckedUtc = nowIso;
  return changed;
}

/** Terapkan hasil evaluasi; setiap perubahan status dicatat sebagai audit trail. */
export function applyEvaluation(setup, evaluation, nowIso, field = 'evaluation') {
  const from = setup[field]?.result ?? null;
  const audit = from !== evaluation.result
    ? [{ tsUtc: nowIso, setupId: setup.setupId, from, to: evaluation.result, reasonCode: evaluation.reasonCode ?? null,
        ...(field === 'evaluation' ? {} : { rule: 'mesin2' }) }] : [];
  setup[field] = evaluation;
  return audit;
}

// Meta per mesin: kapan pelacakan dimulai. Setup yang sudah ada sebelum itu tidak diketahui waktunya.
const metaFile = () => p('meta.json');
export const loadMeta = () => {
  const m = readJson(metaFile(), {});
  return { trackingStartedUtc: {}, ...m };
};
export const saveMeta = (m) => writeJsonAtomic(metaFile(), m);
