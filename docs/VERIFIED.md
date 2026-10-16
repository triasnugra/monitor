[VERIFIED.md](https://github.com/user-attachments/files/33524457/VERIFIED.md)
# Status verifikasi selector, endpoint, dan asumsi

Diperiksa pada 2026-10-16 dengan membuka ketiga URL lewat fetch HTTP biasa (tanpa mengeksekusi JavaScript).

## Terverifikasi
| Item | Bukti |
|---|---|
| Ketiga situs dirender lewat JavaScript | HTML statis hanya berisi kerangka + placeholder ("Menunggu pindai", "Menunggu scan…", "Memuat data Binance...") |
| `/crypto/` punya tombol/teks **"Pindai ulang"** | Muncul di teks halaman statis. *Jenis elemen belum diketahui*; scraper memakai locator teks (`getByText`) |
| `/tn/` punya tombol/teks **"Scan ulang"**, bagian "Sinyal setup", tabel "Jurnal sinyal Asgra" | Teks halaman statis |
| Kedua mesin memakai data Binance | Teks `/crypto/`: "dihitung otomatis dari data Binance"; `/view/`: "Memuat data Binance..." |
| `/view/` adalah dashboard harga (UTC/WIB clock, Hot/Tertinggi/Terendah/Vol 24j) | Teks statis; tidak ada bukti ia menyediakan OHLC historis → tidak dipakai sebagai sumber candle |

## BELUM terverifikasi (tidak ditebak oleh kode)
| Item | Dampak | Cara memverifikasi |
|---|---|---|
| Selector kartu setup `/crypto/` dan `/tn/` | `cardSelector: null` → status `NEEDS_SELECTOR_VERIFICATION` | Jalankan workflow **Discover**, buka `data/discovery/<engine>/candidates.json` & `rendered.html` |
| Kosakata label di kartu (Entry/TP/SL/…) | Label di `src/parsers/shared.js` hanyalah asumsi | Cocokkan dengan `text.txt`; ubah `LABELS` di `parsers/crypto.js` / `tn.js` |
| Penanda "tidak ada setup" | `noSetupMarkerText: null` → 0 kartu = `ZERO_CARDS_UNCONFIRMED` | Lihat `text.txt` saat scan tanpa hasil |
| Ada/tidaknya endpoint JSON atau data terstruktur | Kemungkinan data dihitung di browser dari REST Binance | `network.json`, `globals.json`, `storage.json` hasil Discover |
| Apakah "Jurnal sinyal" (/tn/) menyimpan riwayat | Bisa jadi sumber data lebih stabil | `storage.json` (localStorage) |
| Format angka tampilan (titik/koma) | Parser menandai `AMBIGUOUS_NUMBER_FORMAT` untuk kasus "1,144" | Contoh kartu nyata |
| Ada/tidaknya waktu analisis & timeframe di kartu | Jika tidak ada: waktu analisis = waktu scan (`analysisTimeSource: "scan"`) | Contoh kartu nyata |
| Akses `data-api.binance.vision` / `api.binance.com` dari runner GitHub | HTTP 451/403 jika diblokir | `data/discovery/binance-check.txt` |
| Teks status "dibatalkan" mesin | `cancelPatterns` di `config/settings.json` adalah asumsi | Contoh status nyata |

## Endpoint Binance yang dipakai
`GET /api/v3/klines?symbol=…&interval=1m|15m&startTime=…&endTime=…&limit=1000` (dokumentasi publik Binance Spot). Respons: `[openTime, o, h, l, c, vol, closeTime, …]`.
