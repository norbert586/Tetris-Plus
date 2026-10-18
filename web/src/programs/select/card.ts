// Option mode's memory card screens (docs/re/select.md §3): phase 2 loads the option data,
// 3 saves it, 4 loads the ranking data, 5 saves it; each runs a subphase (state+0x54) table
// (0x80094128, 0x80094168, 0x80094140, 0x800941A0). The card calls go to the shared virtual
// memory cards (src/flow/memcard.ts) the way SELECT makes them through libcard and the BIOS:
// every call finishes within the tick it is made in, as on the original (it waits).
//
// The save file "BASLUS-00338" holds one 8 KB block: a 0x200-byte header, then two copies of
// the state block's state+0x4AD84-0x4B503 (best times, rankings, settings), each after a
// checksum byte (XOR of its 0x780 bytes): copy A at 0x200, copy B at 0x981. The file is kept
// in RAM at 0x800B9D58 while SELECT works on it.
import * as A from '../../core/addr';
import { MemoryCards } from '../../flow/memcard';
import { CD_ERROR, sePlay } from './sound';
import type { Select } from './select';

export const O_CHOICE = 0x800b9c90; // the slot (0, 1) on the slot prompt
export const O_RESULT = 0x800b9cec; // the last card function's result
const O_USED = 0x800b9ce8; // blocks in use (saving a new file)
const O_COUNT = 0x800b9a48; // bytes the last read / write moved
const O_EVENT = 0x800b9050; // the last libcard event
const O_CHAN = 0x800bbd70; // the slot's libcard channel (0x00, 0x10)
const O_FD = 0x800b9bd0;
const TIMER = A.S + 0x1fd0c;

const FILE = 0x800b9d58; // the file, 0x2000 bytes
const COPY_A = 0x800b9f58; // checksum, then 0x780 bytes
const COPY_B = 0x800ba6d9;
const COPY_SIZE = 0x780;
const HEADER = 0x800bd590; // the header is made here, then copied to the file
const DATA = A.S + 0x4ad84; // what the file keeps: state+0x4AD84-0x4B503
const SETTINGS_AT = 0x768; // offset of the settings (state+0x4B4EC, 24 bytes) in a copy
const RANKING_AT = 0xdc; // offset of the ranking data (state+0x4AE60, 0x78 bytes) in a copy
const RANKING_SIZE = 0x78;
const PATHS = 0x800b1cb4; // "bu00:BASLUS-00338", "bu10:..." (255 bytes each)
const DEVICES = 0x800b1eb4; // "bu00:*", "bu10:*" (128 bytes each)
const TITLE = 0x800b1c74; // the save's title (64 bytes, Shift-JIS)
const ICONS = [0x800b1a34, 0x800b1af4, 0x800b1bb4]; // the icon's three frames (16x16 4-bit TIMs)

// The prompts: objects 60 (the message panel), 62 (the choice cursor) and 63 (a message).
const PANEL = 60;
const CURSOR = 62;
const MESSAGE = 63;

/** The card screens' work per phase: 2 load options, 3 save options, 4 load ranking, 5 save ranking. */
export function cardStep(s: Select, phase: number): void {
  const m = s.m;
  const save = phase === 3 || phase === 5;
  const ranking = phase >= 4;
  const sub = m.s32(A.SUBPHASE);
  switch (sub) {
    case 0:
      prompt(s, save);
      return;
    case 1:
      chooseSlot(s);
      return;
    case 2:
      if (save) checkForSave(s);
      else checkForLoad(s);
      return;
    case 3:
      messageWait(s);
      return;
    case 4:
      // FUN_8009A168: back to the menu.
      s.objectClear(PANEL);
      s.objectClear(CURSOR);
      s.objectClear(MESSAGE);
      m.w32(A.PHASE, 1);
      m.w32(A.SUBPHASE, 0);
      return;
    case 5:
      if (!save) {
        // FUN_8009A1AC / FUN_8009A1DC: the loaded file's options or ranking data.
        if (ranking) m.bytes.copyWithin(phys(A.S + 0x4ae60), phys(COPY_A + 1 + RANKING_AT), phys(COPY_A + 1 + RANKING_AT) + RANKING_SIZE);
        else m.bytes.copyWithin(phys(A.SETTINGS), phys(COPY_A + 1 + SETTINGS_AT), phys(COPY_A + 1 + SETTINGS_AT) + 24);
        m.w32(A.SUBPHASE, 4);
      } else {
        checkFile(s);
      }
      return;
    default:
      if (save) saveStep(s, sub, ranking);
      return;
  }
}

function saveStep(s: Select, sub: number, ranking: boolean): void {
  const m = s.m;
  switch (sub) {
    case 6: {
      // FUN_8009A668: a new file.
      const r = saveNew(s);
      m.w32(O_RESULT, r);
      if (r === 0) message(s, 0x100a1, 0x78, 3);
      else m.w32(A.SUBPHASE, 4);
      return;
    }
    case 7:
      yesNo(s, () => {
        m.w32(A.SUBPHASE, 0xd);
        m.w32(TIMER, 4);
      });
      return;
    case 8: {
      // FUN_8009A9C8 (options: settings and ranking data) / FUN_8009AA04 (ranking data) into copy A.
      if (!ranking) m.bytes.copyWithin(phys(COPY_A + 1 + SETTINGS_AT), phys(A.SETTINGS), phys(A.SETTINGS) + 24);
      m.bytes.copyWithin(phys(COPY_A + 1 + RANKING_AT), phys(A.S + 0x4ae60), phys(A.S + 0x4ae60) + RANKING_SIZE);
      m.add32(A.SUBPHASE, 1);
      return;
    }
    case 9: {
      // FUN_8009A838: write the file back.
      let r = cardCheck(s);
      m.w32(O_RESULT, r);
      if (r === 1) {
        r = overwrite(s);
        m.w32(O_RESULT, r);
        if (r !== 0) {
          m.w32(A.SUBPHASE, 4);
          return;
        }
      }
      message(s, 0x100a1, 0x78, 3);
      return;
    }
    case 10: {
      // FUN_8009A8E0: format after the "initializing" message's 3 ticks.
      if (m.add32(TIMER, -1) !== 0) return;
      const r = s.cards ? s.cards.format(cString(s, DEVICES + 128 * m.s32(O_CHOICE))) : 0;
      m.w32(CD_ERROR, r);
      m.w32(O_RESULT, r);
      if (r === 0) message(s, 0x1009d, 0x78, 3);
      else message(s, 0x100a0, undefined, 0xc);
      return;
    }
    case 11:
      yesNo(s, () => {
        const r = cardCheck(s);
        m.w32(O_RESULT, r);
        if (r !== 3) message(s, 0x1009d, 0x78, 3);
        else message(s, 0x1009c, 3, 10);
      });
      return;
    case 12:
      m.w32(A.SUBPHASE, 6);
      return;
    case 13: {
      // FUN_8009AC3C
      if (m.add32(TIMER, -1) !== 0) return;
      if (cardCheck(s) === 1) message(s, 0x100a0, undefined, 8);
      else message(s, 0x100a1, 0x78, 3);
      return;
    }
    default:
      return;
  }
}

// ---- the prompts ----

/** FUN_80099E24 (load) / FUN_8009A2FC (save): "select a slot for the memory card". */
function prompt(s: Select, save: boolean): void {
  const m = s.m;
  const p = A.obj(PANEL);
  m.w32(p + A.O_IMAGE, save ? 0x10099 : 0x10095);
  m.w32(p + A.O_X, 0x600000);
  m.w32(p + A.O_Y, 0x400000);
  const c = A.obj(CURSOR);
  m.w32(c + A.O_IMAGE, 0x10000);
  m.w32(c + A.O_X, 0x770000);
  m.w32(c + A.O_Y, save ? 0x780000 : 0x6d0000);
  m.w32(c + A.O_ANIM, 3);
  s.animStartLoad(CURSOR);
  m.w32(O_CHOICE, 0);
  m.add32(A.SUBPHASE, 1);
}

/** FUN_80099EA8: slot 1 / slot 2; Cross goes on, Circle back to the menu. */
function chooseSlot(s: Select): void {
  const m = s.m;
  const p = s.pressed();
  if (p & 0x40) {
    sePlay(s, 0);
    m.add32(A.SUBPHASE, 1);
  } else if (p & 0x20) {
    sePlay(s, 0x12);
    m.w32(A.SUBPHASE, 4);
  } else if (p & 0xa000) {
    const c = m.s32(O_CHOICE) ^ 1;
    m.w32(O_CHOICE, c);
    m.w32(A.obj(CURSOR) + A.O_ANIM, c + 3);
    m.w32(A.obj(CURSOR) + A.O_X, c === 0 ? 0x770000 : 0xa50000);
    s.animStartLoad(CURSOR);
    sePlay(s, 3);
  } else {
    s.animTick(CURSOR, true);
  }
}

/**
 * FUN_8009A6F4 (overwrite?) / FUN_8009AA40 (initialize?): yes / no in object 62's word +0x4C
 * (default no). Cross on yes runs `yes`; Cross on no, or Circle, goes back to the slot prompt.
 */
function yesNo(s: Select, yes: () => void): void {
  const m = s.m;
  const c = A.obj(CURSOR);
  const p = s.pressed();
  if (p & 0x40) {
    sePlay(s, 0);
    const choice = m.s32(c + A.O_4C);
    if (choice === 0) {
      yes();
      return;
    }
    if (choice === 1) {
      backToPrompt(s);
      return;
    }
  }
  if (p & 0x20) {
    sePlay(s, 0x12);
    backToPrompt(s);
  } else if (p & 0xa000) {
    const choice = m.s32(c + A.O_4C) ^ 1;
    m.w32(c + A.O_4C, choice);
    m.w32(c + A.O_ANIM, choice + 5);
    s.animStartLoad(CURSOR);
    m.w32(c + A.O_X, choice === 0 ? 0x7e0000 : 0xa70000);
    sePlay(s, 3);
  } else {
    s.animTick(CURSOR, true);
  }
}

function backToPrompt(s: Select): void {
  s.objectClear(PANEL);
  s.objectClear(CURSOR);
  s.m.w32(A.SUBPHASE, 0);
}

/** A yes / no question on the panel (object 62 starts on no). */
function question(s: Select, image: number, y: number, subphase: number): void {
  const m = s.m;
  const p = A.obj(PANEL);
  m.w32(p + A.O_IMAGE, image);
  m.w32(p + A.O_X, 0x600000);
  m.w32(p + A.O_Y, 0x400000);
  const c = A.obj(CURSOR);
  m.w32(c + A.O_4C, 1);
  m.w32(c + A.O_IMAGE, 0x10000);
  m.w32(c + A.O_Y, y);
  m.w32(c + A.O_X, 0xa70000);
  m.w32(c + A.O_ANIM, m.s32(c + A.O_4C) + 5);
  s.animStartLoad(CURSOR);
  m.w32(A.SUBPHASE, subphase);
}

/** Clears the prompt and shows message `image` (object 63), with a timer if given. */
function message(s: Select, image: number, timer: number | undefined, subphase: number): void {
  const m = s.m;
  s.objectClear(PANEL);
  s.objectClear(CURSOR);
  const o = A.obj(MESSAGE);
  m.w32(o + A.O_IMAGE, image);
  m.w32(o + A.O_X, 0x600000);
  m.w32(o + A.O_Y, 0x400000);
  if (timer !== undefined) m.w32(TIMER, timer);
  m.w32(A.SUBPHASE, subphase);
}

/** FUN_8009A114: the message shows 120 ticks, then the slot prompt again. */
function messageWait(s: Select): void {
  const m = s.m;
  if (m.add32(TIMER, -1) !== 0) return;
  const o = A.obj(MESSAGE);
  m.w32(o + A.O_IMAGE, 0x10000);
  m.w32(o + A.O_X, 0);
  m.w32(o + A.O_Y, 0);
  m.w32(O_CHOICE, 0);
  m.w32(A.SUBPHASE, 0);
}

/** FUN_80099F9C: check the card, read the file. */
function checkForLoad(s: Select): void {
  const m = s.m;
  let r = cardCheck(s);
  m.w32(O_RESULT, r);
  if (r === 2) return;
  let image: number;
  if (r === 0) image = 0x10096;
  else if (r === 1) {
    r = loadFile(s);
    m.w32(O_RESULT, r);
    if (r === 0) image = 0x10097;
    else if (r !== -1) {
      m.w32(A.SUBPHASE, 5);
      return;
    } else image = 0x1009a;
  } else if (r === 3) image = 0x10097;
  else image = 0x10098;
  message(s, image, 0x78, 3);
}

/** FUN_8009A380: check the card before saving. */
function checkForSave(s: Select): void {
  const m = s.m;
  const r = cardCheck(s);
  m.w32(O_RESULT, r);
  if (r === 2) return;
  if (r === 0) message(s, 0x10096, 0x78, 3);
  else if (r === 3) question(s, 0x1009b, 0x820000, 0xb);
  else if (r === 1) m.w32(A.SUBPHASE, 5);
  else message(s, 0x1009a, 0x78, 3);
}

/** FUN_8009A514: is there a file already (overwrite?), else is there room. */
function checkFile(s: Select): void {
  const m = s.m;
  const r = loadFile(s);
  m.w32(O_RESULT, r);
  if (r !== 0) {
    question(s, 0x1009f, 0x720000, 7);
    return;
  }
  const used = usedBlocks(s);
  m.w32(O_USED, used);
  if (used < 0xf) message(s, 0x100a0, undefined, 0xc);
  else message(s, 0x1009e, 0x78, 3);
}

// ---- the card functions ----

const phys = (a: number) => a & 0x1fffff;

function cString(s: Select, a: number): string {
  let out = '';
  for (let i = 0; i < 255; i++) {
    const c = s.m.u8(a + i);
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}

function path(s: Select): string {
  return cString(s, PATHS + 255 * s.m.s32(O_CHOICE));
}

function cards(s: Select): MemoryCards {
  return s.cards ?? NO_CARDS;
}
const NO_CARDS = new MemoryCards({ load: () => null, save: () => {} });

/**
 * FUN_8009B348: the card in the chosen slot. 1 ready, 3 not formatted, 2 a new card (its flag
 * cleared: check again), 0 no card, -1 a card error.
 */
function cardCheck(s: Select): number {
  const m = s.m;
  const c = cards(s);
  const chan = m.s32(O_CHOICE) << 4;
  m.w32(O_CHAN, chan);
  const e1 = c.info(chan);
  m.w32(O_EVENT, e1);
  if (e1 === 3) {
    m.w32(O_EVENT, c.clear(chan));
    return 2;
  }
  if (e1 === 0) {
    const e3 = c.load(chan);
    m.w32(O_EVENT, e3);
    if (e3 === 3) return 3;
    if (e3 === 0) return 1;
    return e3 === 1 ? -1 : 0;
  }
  return e1 === 1 ? -1 : 0;
}

/**
 * FUN_8009B678 / FUN_8009B6B4: reads the file (7 tries) into 0x800B9D58 and checks it: copy A,
 * else copy B (then copied over A). 1 read, 0 no file, -1 a bad file.
 */
function loadFile(s: Select): number {
  const m = s.m;
  const c = cards(s);
  let opened = false;
  for (let tries = 7; tries > 0; tries--) {
    m.w32(O_COUNT, 0);
    const fd = c.open(path(s), 0x10001);
    let ok = false;
    if (fd !== -1) {
      opened = true;
      const buf = new Uint8Array(0x2000);
      const n = c.read(fd, buf);
      m.bytes.set(buf, phys(FILE));
      m.w32(O_COUNT, n);
      if (n === 0x2000) {
        const v = verify(s);
        if (v === 1) ok = true;
        if (v === 2) {
          ok = true;
          m.bytes.copyWithin(phys(COPY_A), phys(COPY_B), phys(COPY_B) + COPY_SIZE + 1);
        }
      }
    }
    c.close(fd);
    if (ok) return 1;
  }
  return opened ? -1 : 0;
}

function xor(s: Select, copy: number): number {
  let x = 0;
  for (let i = 1; i <= COPY_SIZE; i++) x ^= s.m.u8(copy + i);
  return x;
}

/** FUN_8009BF50: 1 copy A is good, 2 copy B is, 0 neither. */
function verify(s: Select): number {
  const m = s.m;
  if (xor(s, COPY_A) === m.u8(COPY_A)) return 1;
  return xor(s, COPY_B) === m.u8(COPY_B) ? 2 : 0;
}

/** FUN_8009BE54 (and FUN_8009D214's copy of it): both checksums, stored when they agree. */
function checksums(s: Select): boolean {
  const a = xor(s, COPY_A);
  const b = xor(s, COPY_B);
  if (a !== b) return false;
  s.m.w8(COPY_A, a);
  s.m.w8(COPY_B, b);
  return true;
}

/**
 * FUN_8009BB1C / FUN_8009BBE0: the header, then copied to the file. Its first two bytes are the
 * low bytes of the addresses of the strings "S" and "C" (0x800941D8, 0x800941DC), not the
 * characters: a bug in the original, kept.
 */
function header(s: Select): void {
  const m = s.m;
  const h = phys(HEADER);
  const b = m.bytes;
  b[h] = 0xd8;
  b[h + 1] = 0xdc;
  b[h + 2] = 0x13;
  b[h + 3] = 1;
  b.copyWithin(h + 4, phys(TITLE), phys(TITLE) + 0x40);
  b.fill(0, h + 0x44, h + 0x60);
  b.copyWithin(h + 0x60, phys(ICONS[0] + 0x14), phys(ICONS[0] + 0x34));
  for (let i = 0; i < 3; i++) b.copyWithin(h + 0x80 + 0x80 * i, phys(ICONS[i] + 0x40), phys(ICONS[i] + 0xc0));
  b.copyWithin(phys(FILE), h, h + 0x200);
}

function fileBytes(s: Select): Uint8Array {
  return s.m.bytes.slice(phys(FILE), phys(FILE) + 0x2000);
}

/** FUN_8009B7D0: creates the file and writes the whole state+0x4AD84-0x4B503 into it (10 tries). */
function saveNew(s: Select): number {
  const m = s.m;
  const c = cards(s);
  for (let tries = 10; tries > 0; tries--) {
    m.w32(O_COUNT, 0);
    const fd = c.open(path(s), 0x10200);
    m.w32(O_FD, fd);
    if (fd === -1) continue;
    c.close(fd);
    header(s);
    m.bytes.copyWithin(phys(COPY_A + 1), phys(DATA), phys(DATA) + COPY_SIZE);
    m.bytes.copyWithin(phys(COPY_B + 1), phys(DATA), phys(DATA) + COPY_SIZE);
    if (checksums(s)) {
      const w = c.open(path(s), 0x10002);
      m.w32(O_FD, w);
      if (w !== -1) {
        const n = c.write(w, fileBytes(s));
        m.w32(O_COUNT, n);
        c.close(w);
        if (n === 0x2000) return 1;
      }
      c.close(m.s32(O_FD));
      c.delete(path(s));
    }
  }
  return 0;
}

/** FUN_8009D214: writes the file back with copy A (as changed) in both copies (16 tries). */
function overwrite(s: Select): number {
  const m = s.m;
  const c = cards(s);
  for (let tries = 16; ; ) {
    m.w32(O_COUNT, 0);
    const fd = c.open(path(s), 0x10002);
    m.w32(O_FD, fd);
    if (fd !== -1) {
      header(s);
      m.bytes.copyWithin(phys(COPY_B + 1), phys(COPY_A + 1), phys(COPY_A + 1) + COPY_SIZE);
      if (checksums(s)) {
        const n = c.write(fd, fileBytes(s));
        m.w32(O_COUNT, n);
        if (n === 0x2000) {
          c.close(fd);
          return 1;
        }
      }
    }
    tries--;
    c.close(m.s32(O_FD));
    if (tries < 1) return 0;
  }
}

/** FUN_8009BEC8: blocks the card's files use. */
function usedBlocks(s: Select): number {
  const c = cards(s);
  let bytes = 0x1fff;
  for (let e = c.firstfile(cString(s, DEVICES + 128 * s.m.s32(O_CHOICE))); e; e = c.nextfile()) bytes += e.size;
  return bytes >> 13;
}
