import { runScrape } from './base.js';
import { parseCard } from '../parsers/tn.js';
// Catatan: halaman /tn/ punya tabel "Jurnal sinyal" yang mungkin menyimpan sinyal; periksa via Discover (storage.json).
export const scrape = (page, cfg) => runScrape(page, cfg);
export { parseCard };
