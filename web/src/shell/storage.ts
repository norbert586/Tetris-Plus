// What the shell keeps in the browser (docs/re/shell.md §4): the memory cards, exactly as the
// game wrote them (the original keeps all its progress, records and options on the card), and
// the shell's own settings. localStorage, guarded: private windows and blocked storage just
// lose the data at the end of the session.
import { CARD_SIZE, MemoryCard } from '../core/card';
import { DEFAULT_KEYS, type Button } from './input';

const CARD_KEY = (port: number) => `tetris-plus.card${port + 1}`;
const SETTINGS_KEY = 'tetris-plus.settings';

export interface Settings {
  keys: Record<string, Button>;
  /** Master volume, 0-1 (the game's own music and effect volumes are its options). */
  volume: number;
  /** 'integer': the largest whole multiple of 320x240 that fits; 'fit': fill the window at 4:3. */
  scale: 'integer' | 'fit';
  crt: boolean;
  /** Port 2 holds a second card. */
  card2: boolean;
}

export const DEFAULT_SETTINGS: Settings = { keys: DEFAULT_KEYS, volume: 1, scale: 'integer', crt: false, card2: false };

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function put(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage full or blocked: keep running without it
  }
}

export function loadSettings(): Settings {
  try {
    const s = JSON.parse(get(SETTINGS_KEY) ?? '{}');
    return { ...DEFAULT_SETTINGS, ...s, keys: { ...(s.keys ?? DEFAULT_KEYS) } };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  put(SETTINGS_KEY, JSON.stringify(s));
}

function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(t: string): Uint8Array {
  const s = atob(t);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

/** The card stored for a port, or a newly formatted one. */
export function loadCard(port: number): MemoryCard {
  const t = get(CARD_KEY(port));
  if (t) {
    try {
      const data = fromBase64(t);
      if (data.length === CARD_SIZE) return new MemoryCard(data);
    } catch {
      // unreadable: start a blank card
    }
  }
  return new MemoryCard();
}

export function saveCard(port: number, card: MemoryCard): void {
  put(CARD_KEY(port), toBase64(card.data));
}

/** A card image from a file: raw 128 KB .mcd/.mcr, or DexDrive .gme (a 3,904-byte header). */
export function parseCardFile(bytes: Uint8Array): MemoryCard {
  if (bytes.length === CARD_SIZE) return new MemoryCard(bytes);
  if (bytes.length === CARD_SIZE + 3904) return new MemoryCard(bytes.subarray(3904));
  throw new Error(`not a memory card image (${bytes.length} bytes; expected ${CARD_SIZE})`);
}
