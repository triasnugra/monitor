# Crypto Engine Benchmark

Merekam setiap setup dari **Mesin 1** (`/crypto/`) dan **Mesin 2** (`/tn/`), mengevaluasinya terhadap candle Binance (TP / SL / dll.), lalu membandingkan performa secara statistik. Hasil bersifat **teoretis berbasis candle** (bukan trading nyata).

> ## ⚠️ Status penting
> Struktur DOM kedua situs **belum bisa diverifikasi** (halamannya dirender JavaScript). Karena itu `cardSelector` sengaja `null` dan scraper melaporkan `NEEDS_SELECTOR_VERIFICATION` — bukan setup palsu. Langkah 3 di bawah menyelesaikannya. Evaluator, statistik, penyimpanan, dashboard, dan workflow sudah selesai dan teruji.

## Setup (cukup lewat web GitHub)
1. Buat repo baru, unggah seluruh isi proyek (termasuk folder `.github/`; bila drag-and-drop tidak membawa folder tersembunyi, buat file `.github/workflows/*.yml` manual lewat *Add file → Create new file*).
2. **Settings → Pages → Source: GitHub Actions.** **Settings → Actions → General → Workflow permissions: Read and write.**
3. **Actions → "Discover" → Run workflow.** Hasil di `data/discovery/` (`candidates.json`, `rendered.html`, `text.txt`, `network.json`, `storage.json`, `globals.json`, `binance-check.txt`). Dari situ:
   - isi `cardSelector` di `config/sources.json` (dan `noSetupMarkerText` bila ada),
   - sesuaikan `LABELS` di `src/parsers/crypto.js` & `tn.js`,
   - jika `network.json`/`globals.json`/`storage.json` menunjukkan data terstruktur, parser JSON langsung lebih stabil daripada DOM — tempel isinya ke percakapan agar parser disesuaikan.
4. **Actions → "Collect, evaluate, deploy" → Run workflow.** Setelah itu berjalan terjadwal tiap ±30 menit (**best-effort**: GitHub tidak menjamin ketepatan jadwal). Dashboard: `https://<user>.github.io/<repo>/`.
5. GitHub Secrets: **tidak diperlukan** (Binance market data publik). Jika nanti perlu, simpan di *Settings → Secrets* dan baca via `process.env`.

## Alur
`collect` (Playwright → kartu mentah → parser per mesin → normalisasi → upsert idempoten) → `evaluate` (candle Binance → status) → `build` (statistik → `site/data/dashboard.json`). Perintah: `npm run collect|evaluate|build|all`, `npm test`.

## Keputusan desain (selain spesifikasi)
- **Waktu analisis**: bila kartu tidak memuat waktu bertanda zona, dipakai waktu scan (`analysisTimeSource: "scan"`) — mesin menghitung di browser saat scan.
- **Presisi hasil**: candle 1m sampai batas 15m pertama, lalu 15m; setiap kejadian (entry/TP/SL) **dipertajam ke 1m**. Waktu hasil = awal menit tersebut. TP & SL pada menit yang sama → `AMBIGUOUS`.
- **Candle yang sudah berjalan saat analisis dibuang**; hanya candle tertutup yang dipakai.
- **TP tercapai sebelum entry tersentuh** → `EXPIRED` (kode `TP_REACHED_BEFORE_ENTRY`), bukan menang.
- **Waktu hasil non-candle** ditandai `resultTimeSource`: `timeout` (kedaluwarsa) / `scraper` (CANCELLED, waktu deteksi — bukan bukti harga).
- **Celah data candle** mencegah vonis `EXPIRED` → `AMBIGUOUS`.
- **Klaster near-duplicate**: mesin dapat menerbitkan ulang ide yang sama tiap scan. Statistik utama memakai *sampel independen* (satu per klaster: engine+simbol+arah, ≤24 jam, entry ±1%); semua setup tetap tersimpan dan bisa dilihat ("Semua setup").
- **Verdict** "mesin lebih baik" hanya muncul bila tiap mesin ≥30 setup selesai dan CI95 bootstrap selisih expectancy tidak mencakup 0.
- **Sanity check harga**: level menyimpang >50% dari harga pasar → `INVALID` (menangkap salah baca format angka).
- Audit trail: `data/audit.jsonl` mencatat setiap perubahan status. Status final tidak dievaluasi ulang kecuali `node src/index.js evaluate --reeval-final` (tetap diaudit).

## Asumsi & keterbatasan
- Fill limit dianggap terjadi saat harga **menyentuh** level (nyata: belum tentu terisi/antrean). Fill pada level (bukan open saat gap). Rentang entry: LONG diisi di tepi atas, SHORT di tepi bawah. Market: open candle pertama setelah analisis.
- Tanpa fee, funding, dan slippage. R = |TP−fill| / |fill−SL| untuk TP, −1 untuk SL.
- Hanya **TP pertama** yang menjadi target evaluasi (TP lain tersimpan di data mentah).
- Entry yang terpicu tapi belum selesai setelah 30 hari → `EXPIRED` (tidak dihitung menang/kalah). Entry tak tersentuh 72 jam → `EXPIRED`. Ubah di `config/settings.json`.
- `CANCELLED` bergantung pada `cancelPatterns` (asumsi, belum terverifikasi).
- Setup berurutan dari satu mesin berkorelasi; CI bersifat indikatif.
- Fixture tes bersifat **sintetis** (termasuk contoh SUI SHORT): menguji logika, bukan fakta pasar. Contoh SUI **tidak** dianggap terkonfirmasi sampai data Binance nyata mendukungnya.

## Troubleshooting
| Gejala | Penyebab / tindakan |
|---|---|
| Dashboard: "selector belum diverifikasi" | Lakukan langkah 3 |
| `FETCH_FAILED` | Lihat Diagnostics: HTTP/timeout/JS error; coba run ulang |
| `ZERO_CARDS_UNCONFIRMED` | Selector mungkin salah, atau isi `noSetupMarkerText` |
| `priceDataError` (HTTP 451/403) | Binance memblokir runner; ubah `binanceBaseUrls` di settings; lihat `binance-check.txt` |
| Push gagal | Concurrency + retry sudah ada; pastikan izin *Read and write* |
| Banyak `INVALID` `PRICE_SANITY` | Format angka salah baca; cek `warnings` (`AMBIGUOUS_NUMBER_FORMAT`) |

## Struktur
`src/{scrapers,parsers,browser,price-data,evaluator,statistics,storage,tools}`, `src/normalize.js`, `src/aggregate.js`, `src/index.js`, `test/`, `site/`, `config/`, `data/`, `docs/VERIFIED.md`, `.github/workflows/`.
