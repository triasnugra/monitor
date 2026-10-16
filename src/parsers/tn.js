import { DEFAULT_LABELS, parseCardWith } from './shared.js';
// Mesin 2 (/tn/). Override label di sini setelah diverifikasi lewat data/discovery/tn/.
export const LABELS = { ...DEFAULT_LABELS };
export const parseCard = parseCardWith(LABELS, 'tn');
