# Crypto Engine Benchmark

Merekam setiap setup dari **Mesin 1** (`/crypto/`) dan **Mesin 2** (`/tn/`), mengevaluasinya terhadap
candle Binance (TP / SL / dll.), lalu membandingkan performa. Hasil bersifat **teoretis berbasis candle**,
bukan trading nyata. Status tiap selector dan asumsi ada di `docs/VERIFIED.md`.

## Sumber data
- **Mesin 1:** DOM halaman (`#setups > article.c`), dibuka dengan Playwright. Waktu analisis tidak ditampilkan
  di kartu, jadi setup yang sudah ada sebelum pelacakan dimulai diberi status `ANALYSIS_TIME_UNKNOWN`
  dan tidak dievaluasi.
- **Mesin 2:** `data/journal.json` (JSON publik yang juga dimuat halaman /tn/). Tanpa browser.
- **Harga:** Binance Spot klines (`data-api.binance.vision`).

## Setup (cukup lewat web GitHub)
1. Unggah isi proyek ke repo (termasuk `.github/`).
2. **Settings → Pages → Source: GitHub Actions.** **Settings → Actions → General → Workflow permissions: Read and write.**
3. **Actions → "Collect, evaluate, deploy" → Run workflow.** Jalan terjadwal ±30 menit (best-effort).
4. Dashboard: `https://<user>.github.io/<repo>/`.

Tidak perlu GitHub Secrets (data publik).

## Alur
`collect` (sumber → item mentah → `TO_RECORD[engine]` → `buildRecord` → upsert idempoten) →
`evaluate` (candle Binance → status) → `build` (statistik → `site/data/dashboard.json`).
`npm test` dijalankan di workflow sebelum koleksi; kegagalan test menghentikan run.

## Aturan utama
- **Status final:** `TP`, `SL`, `CANCELLED`, `EXPIRED`, `INVALID`, `AMBIGUOUS`. `PENDING` untuk yang masih aktif.
- **Hasil sumber disimpan terpisah** (`sourceResult`). Dashboard menampilkan ketidaksesuaian TP/SL antara
  sumber dan evaluasi kita di Data Quality.
- **Waktu analisis:**
  - `source`: dari sumber (Mesin 2).
  - `first_seen`: waktu scan pertama kali melihat setup (Mesin 1, setelah pelacakan dimulai).
  - `unknown_before_tracking`: setup yang sudah ada saat pelacakan dimulai (Mesin 1). Tidak dievaluasi.
- **Setup baru dari sumber yang sama tidak menimpa histori.** ID Mesin 2 berasal dari hash `h` jurnal;
  ID Mesin 1 berasal dari level kartu (stabil antar-scan).
- **TP tercapai sebelum entry tersentuh** → `EXPIRED`, bukan menang.
- **TP dan SL dalam candle yang sama** → diselesaikan dengan candle 1m; jika tetap ambigu → `AMBIGUOUS`.
- **Verdict** "mesin lebih baik" hanya muncul jika tiap mesin punya ≥30 setup selesai dan CI95 bootstrap
  selisih expectancy tidak mencakup 0.
- Sampel independen: satu setup per klaster near-duplicate (engine + simbol + arah, ≤24 jam, entry ±1%).

## Asumsi & keterbatasan
- Fill limit dianggap terjadi saat harga menyentuh level. Tanpa fee, funding, dan slippage.
- R = |TP−fill| / |fill−SL| untuk TP; −1 untuk SL. Hanya TP pertama yang dievaluasi.
- TTL entry 72 jam dan batas hold 30 hari (config/settings.json). Journal Mesin 2 memakai `due` 7 hari;
  aturan yang sama diterapkan ke kedua mesin, jadi perbedaan status kedaluwarsa dicatat, bukan disamakan diam-diam.
- Setup berurutan dari satu mesin berkorelasi; CI bersifat indikatif.

## Troubleshooting
| Gejala | Penyebab / tindakan |
|---|---|
| `FETCH_FAILED` Mesin 1 | Lihat Diagnostics (HTTP/timeout/JS error). Run ulang. |
| `ZERO_CARDS_UNCONFIRMED` Mesin 1 | Struktur halaman mungkin berubah. Jalankan Discover dan bandingkan dengan `docs/VERIFIED.md`. |
| `SUMMARY_COUNT_MISMATCH` | Jumlah kartu tidak sama dengan ringkasan halaman. Periksa `rendered.html` terbaru. |
| `JOURNAL_HTTP_*` Mesin 2 | journal.json tidak bisa diambil; run berikutnya akan mencoba lagi. |
| `TIME_MISMATCH` | Field `t` tidak sama dengan `waktu` pada entri jurnal. Dicatat sebagai peringatan. |
| `priceDataError` (HTTP 451/403) | Binance memblokir runner. Ubah `binanceBaseUrls` di settings. |
| Push gagal | Concurrency dan retry sudah ada. Pastikan izin *Read and write*. |

## Menjalankan lokal
`npm ci && npm test`. Koleksi nyata membutuhkan `npx playwright install chromium`.
