# Status verifikasi selector, endpoint, dan asumsi

Setiap item ditandai salah satu dari: **TERVERIFIKASI** (dibuktikan dari file di repo atau dari
data nyata yang diunduh), **ASUMSI** (belum dibuktikan, sistem tidak boleh bergantung padanya tanpa
pemeriksaan), **BELUM** (belum diperiksa).

## Mesin 1 — https://triasnugra.github.io/crypto/

| Item | Status | Bukti / catatan |
|---|---|---|
| Kartu setup: `div#setups > article.c[data-s]` (30 kartu) | TERVERIFIKASI | `data/discovery/crypto/rendered.html`. Fixture `test/fixtures/crypto-setups.html` diambil dari file ini. |
| Ticker: `h3` di dalam kartu | TERVERIFIKASI | Kartu |
| Arah: `.t > span > span.ch.L` (Long) / `.ch.S` (Short) | TERVERIFIKASI | 28 Long, 2 Short di rendered.html |
| Status: chip ke-3 di header (`Aktif` / `Menunggu retest` / `Jauh`) | TERVERIFIKASI | Kelas `ch ok`, `ch wait`, `ch ` |
| Entry: label `Entry limit`, nilai di teks sesudah `<span>` | TERVERIFIKASI | 30/30 kartu "Entry limit" |
| SL: label `SL x%` (x = jarak SL dari entry, BUKAN risiko per trade), nilai harga | TERVERIFIKASI | 30/30 kartu |
| TP: label `TP1` atau `TP2` | TERVERIFIKASI | 22 TP1, 8 TP2. Label disimpan di rawData.tpLabel |
| `Rasio ke target akhir` (mis. 10.9R) | TERVERIFIKASI | Ini R ke target akhir, bukan ke TP1. Disimpan sebagai rawData.rrToFinalTarget. riskReward dihitung dari TP1. |
| Alasan: teks `div.m` pertama sebelum ". Harga" | TERVERIFIKASI | Pola teks 30/30 |
| Risiko $ dan qty: `.sz` ("Risiko $10: qty 18.5 AVAX, nilai posisi $214") | TERVERIFIKASI | 30/30 |
| Ringkasan `#st`: "Selesai: N koin punya setup" | TERVERIFIKASI | Dicek konsisten dengan jumlah kartu (SUMMARY_COUNT_MISMATCH) |
| Kartu juga muncul di `#top3` (3 kartu duplikat) | TERVERIFIKASI | Scraper hanya membaca `#setups` |
| **Waktu analisis** | **BELUM ADA** | Kartu tidak menampilkan waktu. Setup yang sudah ada sebelum pelacakan diberi `unknown_before_tracking` dan tidak dievaluasi. Setup baru diberi `first_seen` (waktu scan pertama kali melihatnya, error ≤ jarak antar-scan). |
| Field `riskPercent` | BELUM ADA | Tidak ditampilkan di kartu. Tidak diisi. |
| `cancelPatterns` (teks "batal") | ASUMSI | Belum pernah muncul di data. |
| Kartu tetap selama halaman dimuat ulang | ASUMSI | Belum diuji di browser sungguhan dari runner. |

**Catatan integritas:** level kartu bisa berubah antar-scan (engine menghitung ulang). Perubahan level
membuat setupId baru, sehingga satu ide bisa tercatat lebih dari sekali. Ini ditangani oleh klaster
near-duplicate di statistik, bukan dengan menimpa.

## Mesin 2 — https://triasnugra.github.io/tn/

| Item | Status | Bukti / catatan |
|---|---|---|
| Sumber: `https://triasnugra.github.io/tn/data/journal.json` | TERVERIFIKASI | Dimuat halaman /tn/ (network.json). Berisi array 66 entri per 2026-10-16. |
| Field: `id, waktu, t, aset, arah, entry, sl, tp, alasan, hasil, R, h` | TERVERIFIKASI | Isi entri dari file |
| `t` (epoch ms) cocok dengan `waktu` | TERVERIFIKASI | Dicek dalam test untuk fixture (tidak ada TIME_MISMATCH) |
| `h` unik per entri (hash rantai) | TERVERIFIKASI | Sembilan entri fixture unik; dua BTC SHORT 86620 pada hari berbeda punya h berbeda |
| `Entry limit` untuk semua setup | TERVERIFIKASI (DOM) / ASUMSI (JSON) | 24 kemunculan "Entry limit" di DOM /tn/. JSON tidak punya field tipe entry; diasumsikan limit sama seperti DOM. |
| `forward-report.json` (ringkasan forward-test) | TERVERIFIKASI | Dipakai hanya untuk diagnostik |
| Arti `bm` dan `bi` | BELUM | Dua skenario hasil yang berbeda dalam satu entri. Disimpan utuh di rawData, tidak dipakai. |
| Arti `hasil: "tidak terisi"` | ASUMSI | Diperlakukan sebagai originalStatus; tidak dipetakan ke CANCELLED. |
| `due` = t + 7 hari | TERVERIFIKASI (angka) | Sistem ini memakai TTL 72 jam sendiri (config/settings.json). Perbedaan ini menyebabkan perbedaan status "kedaluwarsa" dan harus dicatat saat membandingkan. |
| Journal diperbarui otomatis | BELUM | File statis di GitHub Pages; tidak diketahui seberapa sering diperbarui. Scraper memakai query `?_=` agar tidak mengambil cache lama. |

**Perbedaan dengan DOM /tn/:** kartu DOM /tn/ (`div.c > div.g4`) hanya dipakai untuk pemeriksaan,
bukan sumber. Scraper tidak memakai DOM Mesin 2.

## Binance (sumber harga untuk evaluasi)

| Item | Status | Bukti |
|---|---|---|
| `data-api.binance.vision/api/v3/klines` dapat diakses dari runner | TERVERIFIKASI | Log network discovery: semua permintaan HTTP 200 |
| Simbol `*USDT` untuk semua ticker (termasuk NVDAB, SNDKB, XAUT, CRCLB, SOXLB, SPCXB) | TERVERIFIKASI | Permintaan klines di network.json dengan simbol tersebut berstatus 200 |
| Format respons klines `[openTime, o, h, l, c, vol, closeTime, ...]` | TERVERIFIKASI (dokumentasi publik Binance) | — |

## Yang belum diuji di lingkungan pengembangan

- Ekstraksi DOM di Chromium sungguhan (fungsi sudah diuji dengan linkedom dan diserialisasi seperti page.evaluate, tetapi belum di browser). Tes pertama: workflow Collect.
- Pengambilan `journal.json` dari situs langsung (lingkungan pengembangan tidak punya akses ke github.io). Tes pertama: workflow Collect.

## Insiden: Discover #4 dibatalkan setelah 14m41s

- Gejala: `discovery crypto: 169 network entries`, lalu `The operation was canceled` saat tn berjalan.
- Penyebab langsung: job mencapai `timeout-minutes: 15`. Penyebab akar **belum diketahui**: satu langkah pada
  mesin kedua tidak pernah selesai. `page.evaluate()` Playwright tidak punya timeout bawaan, sehingga
  halaman yang memblokir thread utamanya membuat langkah menunggu tanpa batas.
- Perbaikan: semua langkah browser kini dibatasi `withTimeout`; Discover menulis `status.json` per mesin
  yang mencatat langkah mana yang macet; hasil parsial tetap dikomit (`if: always()`).
- Jika terulang: buka `data/discovery/<mesin>/status.json` untuk melihat langkah yang gagal.
