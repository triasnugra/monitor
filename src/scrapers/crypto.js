import { runScrape } from './base.js';
import { parseCard } from '../parsers/crypto.js';
export const scrape = (page, cfg) => runScrape(page, cfg);
export { parseCard };
