#!/usr/bin/env python3
"""Function-level verification fixtures (docs/RESEARCH_AND_PLAN.md §8, layer 1).

Runs original PAZLE.EXE routines in Unicorn on generated game states and records what each
one does, for web/test/unicorn.test.ts to replay on the TypeScript core:

  unicorn_fixtures.py PAZLE.EXE web/test/fixtures/unicorn [--cases N] [--only NAME,...]

Each case starts from the same base memory the core starts from (the EXE's data at its
addresses, the shared block's boot defaults from web/src/core/boot-state.ts, BSS zero), then
writes the case's inputs (after storing the state pointer, as pazle_main does): a player index, a board, piece, professor or ceiling state, pad
words and so on. The routine runs from its entry point until it returns. Recorded:

- every 32-bit word that differs from the pre-call memory in PAZLE.EXE's data and BSS
  (0x800D4FB0-0x800F3703) and in the shared state block (state to state+0x4B53F);
- the return value (v0), the rand() calls and seed, and se_play/bgm_request arguments.

rand() (the BIOS stub at 0x800C0C48), se_play and bgm_request are replaced by hooks: rand
with the BIOS LCG, the sound calls with a recorder. item_load (image decoding into VRAM) is
skipped. Output: one gzipped JSON file per routine.
"""
import argparse
import base64
import gzip
import json
import os
import random
import re
import struct
import sys

from unicorn import Uc, UC_ARCH_MIPS, UC_MODE_MIPS32, UC_MODE_LITTLE_ENDIAN, UC_HOOK_CODE
from unicorn.mips_const import (UC_MIPS_REG_A0, UC_MIPS_REG_A1, UC_MIPS_REG_A2, UC_MIPS_REG_A3,
                                UC_MIPS_REG_PC, UC_MIPS_REG_RA, UC_MIPS_REG_SP, UC_MIPS_REG_V0)

S = 0x8003E668
RAND, SE_PLAY, BGM_REQUEST, ITEM_LOAD = 0x800C0C48, 0x80095778, 0x80095DA8, 0x8009740C
RETURN = 0x80001000  # magic return address
STATE_PTR = 0x800ED328
STACK = 0x801FFF00
WATCH = [(0x800D4FB0, 0x800F3704), (S, S + 0x4B540)]

REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')

# ---------------------------------------------------------------- addresses (re/symbols/PAZLE.vars.tsv)
PLAYER, OBJ_BASE = 0x800EEAD0, 0x800EE410
PAD_HELD, PAD_PRESSED = 0x800F36F2, 0x800F36F4
BOARD = 0x800EDCA0
V = {}
for line in open(os.path.join(REPO, 're/symbols/PAZLE.vars.tsv')):
    if line.startswith('#') or not line.strip():
        continue
    a, _, name = line.split('\t')[:3]
    if '+' not in a:
        V[name] = int(a, 16)
OBJ = lambda n: S + 0x5C + n * 0x7C  # noqa: E731
O_IMAGE, O_ANIM = 0x24, 0x2C


def load_exe(path):
    data = open(path, 'rb').read()
    t_addr, t_size = struct.unpack_from('<II', data, 0x18)
    return t_addr, data[0x800:0x800 + t_size]


def boot_state():
    text = open(os.path.join(REPO, 'web/src/core/boot-state.ts')).read()
    off = int(re.search(r'BOOT_STATE_OFFSET = (0x[0-9a-f]+)', text).group(1), 16)
    b64 = ''.join(re.findall(r"'([A-Za-z0-9+/=]+)'", text))
    return off, base64.b64decode(b64)


class Machine:
    def __init__(self, exe):
        self.t_addr, self.body = load_exe(exe)
        self.boot_off, self.boot = boot_state()
        self.mu = Uc(UC_ARCH_MIPS, UC_MODE_MIPS32 | UC_MODE_LITTLE_ENDIAN)
        self.mu.mem_map(0, 0x200000)
        self.mu.hook_add(UC_HOOK_CODE, self._hook, begin=RAND, end=RAND)
        self.mu.hook_add(UC_HOOK_CODE, self._hook, begin=SE_PLAY, end=SE_PLAY)
        self.mu.hook_add(UC_HOOK_CODE, self._hook, begin=BGM_REQUEST, end=BGM_REQUEST)
        self.mu.hook_add(UC_HOOK_CODE, self._hook, begin=ITEM_LOAD, end=ITEM_LOAD)

    def reset(self, seed):
        mu = self.mu
        mu.mem_write(0, bytes(0x200000))
        mu.mem_write(self.t_addr & 0x1FFFFF, self.body)
        mu.mem_write((S + self.boot_off) & 0x1FFFFF, self.boot)
        self.w32(STATE_PTR, S)  # pazle_main stores the boot program's state pointer here
        self.seed = seed
        self.calls = 0
        self.se = []
        self.bgm = []

    def _hook(self, mu, address, size, user):
        a0 = mu.reg_read(UC_MIPS_REG_A0)
        if address == RAND:
            self.seed = (self.seed * 1103515245 + 12345) & 0xFFFFFFFF
            self.calls += 1
            mu.reg_write(UC_MIPS_REG_V0, (self.seed >> 16) & 0x7FFF)
        elif address == SE_PLAY:
            self.se.append(a0 - (1 << 32) if a0 & 0x80000000 else a0)
        elif address == BGM_REQUEST:
            self.bgm.append(a0 - (1 << 32) if a0 & 0x80000000 else a0)
        mu.reg_write(UC_MIPS_REG_PC, mu.reg_read(UC_MIPS_REG_RA))

    def w32(self, addr, value):
        self.mu.mem_write(addr & 0x1FFFFF, struct.pack('<I', value & 0xFFFFFFFF))

    def w16(self, addr, value):
        self.mu.mem_write(addr & 0x1FFFFF, struct.pack('<H', value & 0xFFFF))

    def w8(self, addr, value):
        self.mu.mem_write(addr & 0x1FFFFF, bytes([value & 0xFF]))

    def r32(self, addr):
        return struct.unpack('<I', self.mu.mem_read(addr & 0x1FFFFF, 4))[0]

    def snapshot(self):
        return [bytes(self.mu.mem_read(a & 0x1FFFFF, b - a)) for a, b in WATCH]

    def call(self, entry, args=(), stack_args=()):
        mu = self.mu
        sp = STACK
        for i, v in enumerate(stack_args):
            self.w32(sp + 0x10 + 4 * i, v)
        mu.reg_write(UC_MIPS_REG_SP, sp)
        for reg, v in zip((UC_MIPS_REG_A0, UC_MIPS_REG_A1, UC_MIPS_REG_A2, UC_MIPS_REG_A3), args):
            mu.reg_write(reg, v & 0xFFFFFFFF)
        mu.reg_write(UC_MIPS_REG_RA, RETURN)
        mu.emu_start(entry, RETURN, count=5_000_000)
        v0 = mu.reg_read(UC_MIPS_REG_V0)
        return v0 - (1 << 32) if v0 & 0x80000000 else v0


def diff(before, after):
    out = []
    for (a, _), x, y in zip(WATCH, before, after):
        for i in range(0, len(x), 4):
            if x[i:i + 4] != y[i:i + 4]:
                out.append([a + i, struct.unpack_from('<i', y, i)[0]])
    return out


# ---------------------------------------------------------------- input generators

class Case:
    """Collects a case's input writes so the TypeScript side can apply the same ones."""

    def __init__(self, m, rng):
        self.m, self.rng, self.writes = m, rng, []

    def w(self, addr, value, size=4):
        value &= (1 << (8 * size)) - 1
        self.writes.append([addr, size, value])
        {4: self.m.w32, 2: self.m.w16, 1: self.m.w8}[size](addr, value)

    def pv(self, name, value):
        self.w(V[name] + 4 * self.p, value)

    def player(self):
        self.p = self.rng.randrange(2)
        self.w(PLAYER, self.p)
        self.w(OBJ_BASE, self.p * 400)

    def board(self, density=None, full_rows=0):
        rng = self.rng
        d = density if density is not None else rng.choice([0.0, 0.2, 0.5, 0.8])
        base = BOARD + self.p * 0x348
        for col in range(10):
            self.w(base + 4 * col, 0xFFFF if col < 3 or col > 6 else (rng.randrange(1, 8) if rng.random() < 0.05 else 0))
        full = set(rng.sample(range(1, 16), full_rows)) if full_rows else set()
        for row in range(1, 16):
            for col in range(10):
                v = rng.randrange(1, 9) if (row in full or rng.random() < d) else 0
                self.w(base + 4 * (row * 10 + col), v)

    def pads(self, mask=0xFFFF):
        held = self.rng.randrange(0x10000) & mask & self.rng.choice([0xFFFF, 0xF000, 0x00F0, 0x4000, 0x2000, 0x8000, 0])
        prev = self.rng.randrange(0x10000) & mask
        self.w(PAD_HELD + 6 * self.p, held, 2)
        self.w(PAD_PRESSED + 6 * self.p, (prev ^ held) & held, 2)

    def counter(self):
        self.w(S + 0x40, self.rng.randrange(1 << 32))

    def objects(self, first, count, image_prob=0.5, fields=(0x00, 0x04)):
        """Random images (and the given fields) for objects first..first+count-1 of the player."""
        for n in range(first, first + count):
            k = n + self.p * 400
            if self.rng.random() < image_prob:
                self.w(OBJ(k) + O_IMAGE, self.rng.choice([0x10005, 0x1000B, 0x80010009, 0x10021]))
                for off in fields:
                    self.w(OBJ(k) + off, self.rng.randrange(-0x400000, 0x400000))


def gen_piece(c):
    c.player()
    c.board()
    rng = c.rng
    c.pv('piece_kind', rng.randrange(1, 8))
    c.pv('piece_rot', rng.randrange(4))
    c.pv('piece_x', rng.randrange(-3, 10) * 0xA0000)
    c.pv('piece_y', rng.randrange(-3, 16) * 0xA0000)


def gen_play_fall(c):
    gen_piece(c)
    rng = c.rng
    c.pads()
    c.counter()
    for name, hi in (('piece_has_dropped', 2), ('das_delay', 21), ('das_repeat', 5), ('gravity_count', 60),
                     ('lock_count', 11), ('stage_time', 10000), ('stage_time_sub', 7)):
        c.pv(name, rng.randrange(hi))


def gen_lines(c):
    c.player()
    c.board(full_rows=c.rng.randrange(5))
    rng = c.rng
    c.pv('lock_top_row', rng.randrange(-2, 16))
    for i in range(5):
        c.w(V['full_rows'] + c.p * 0x14 + 4 * i, rng.choice([0, 0, 1]))
    c.objects(0x32, 160, 0.3, ())


def gen_queue(c):
    c.player()
    c.pv('next2', c.rng.randrange(1, 8))
    c.pv('piece_kind', c.rng.randrange(0, 8))


def gen_input(c):
    c.player()
    c.pads()
    c.pv('das_delay', c.rng.randrange(21))
    c.pv('das_repeat', c.rng.randrange(5))


def gen_score(c):
    c.player()
    c.pv('score', c.rng.choice([0, 1234, 9999000, 9998500, c.rng.randrange(10000000)]))
    c.pv('lines_cleared', c.rng.randrange(5))


def gen_ceiling(c):
    c.player()
    rng = c.rng
    c.counter()
    c.w(S + 0x4B4FE, rng.randrange(4), 1)
    c.pv('ceiling_drops', rng.randrange(50))
    c.pv('ceiling_timer', rng.randrange(2500))
    y = rng.randrange(1, 13) * 0xA0000
    c.pv('ceiling_y', y)
    c.pv('ceiling_pushback', rng.choice([0, 0, -0xA0000, -0x140000]))
    c.pv('ceiling_shake', rng.randrange(2))
    c.w(OBJ(0xE5 + c.p * 400) + 4, y + rng.choice([0, -0x10000, 0x10000]))


def gen_crush(c):
    c.player()
    c.board()
    c.pv('ceiling_y', c.rng.randrange(1, 14) * 0xA0000)
    c.objects(0x32, 160, 0.3)
    c.objects(0x11D, 20, c.rng.choice([0.0, 0.5, 0.95, 1.0]), ())


def gen_debris(c):
    c.player()
    c.counter()
    for n in range(0x11D, 0x131):
        k = n + c.p * 400
        if c.rng.random() < 0.7:
            c.w(OBJ(k) + O_IMAGE, c.rng.choice([0x10005, 0x1000B, 0x80010009]))
            c.w(OBJ(k) + 0x28, c.rng.randrange(2))
            c.w(OBJ(k) + 0x0C, c.rng.choice([-0x780, -0x800, 0, -0x100]))
            c.w(OBJ(k) + 0x4C, c.rng.randrange(-1, 49))
            for off in (0x00, 0x04, 0x08, 0x38, 0x3C):
                c.w(OBJ(k) + off, c.rng.randrange(-0x400000, 0x400000))


def gen_prof(c):
    c.player()
    c.board()
    rng = c.rng
    c.pv('prof_col', rng.randrange(-1, 10))
    c.pv('prof_row', rng.randrange(0, 16))
    c.pv('prof_facing', rng.randrange(2))
    c.pv('prof_fake_ground', 1 if rng.random() < 0.05 else 0)


ACTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 0xA, 0xB, 0xC, 0xD, 0xE, 0xF, 0x10, 0x15, 0x1F, 0x21, 0x22, 0x23, 0]


def gen_think(c):
    gen_prof(c)
    rng = c.rng
    ch = rng.choice([0, 0, 1, 1, 2, 3])
    c.pv('prof_anim_channel', ch)
    for k in range(4):
        c.w(V['prof_channel_action'] + c.p * 0x10 + 4 * k, rng.choice(ACTIONS))
        c.w(V['prof_channel_script'] + c.p * 0x10 + 4 * k, rng.choice([0, 0x800DC894]))
    c.pv('prof_action', rng.choice(ACTIONS))
    c.w(V['prof_prev_action'] + c.p * 0x10, rng.choice(ACTIONS))
    for name, hi in (('prof_action_done', 2), ('prof_fall_state', 4), ('prof_lifted', 2), ('prof_turns', 10),
                     ('lines_found', 2), ('lines_for_professor', 3), ('prof_danger_prev', 2), ('stage', 20)):
        c.pv(name, rng.randrange(hi))
    c.pv('lock_top_row', rng.randrange(-2, 16))
    for i in range(5):
        c.w(V['full_rows'] + c.p * 0x14 + 4 * i, rng.randrange(2))
    c.pv('ceiling_y', rng.randrange(1, 15) * 0xA0000)
    if rng.random() < 0.3:
        think_scenario(c)


def think_scenario(c):
    """Places blocks around the professor so the rarer decisions (trapped, landings) happen."""
    rng = c.rng
    col, row = rng.randrange(1, 8), rng.randrange(3, 15)
    facing = rng.randrange(2)
    c.pv('prof_col', col)
    c.pv('prof_row', row)
    c.pv('prof_facing', facing)
    c.pv('prof_fake_ground', 0)
    base = BOARD + c.p * 0x348
    cell = lambda dc, dr, v: c.w(base + 4 * ((row + dr) * 10 + col + dc), v)  # noqa: E731
    ahead, behind = (2, -1) if facing == 0 else (-1, 2)
    for dc in (0, 1):
        cell(dc, 0, 0)
        cell(dc, -1, 0)
        cell(dc, 1, rng.choice([0, 3]) if rng.random() < 0.3 else 3)
    cell(ahead, rng.choice([0, -1]), 5 if rng.random() < 0.8 else 0)
    cell(behind, rng.choice([0, -1]), 5 if rng.random() < 0.8 else 0)
    kind = rng.choice(['trapped', 'land_long', 'land_short'])
    ch = 1 if kind == 'trapped' else 2
    c.pv('prof_anim_channel', ch)
    c.w(V['prof_channel_script'] + c.p * 0x10 + 4 * ch, 0)
    if kind == 'trapped':
        c.w(V['prof_channel_action'] + c.p * 0x10 + 4 * ch, rng.choice([6, 7, 0x22, 0x23]))
        c.pv('prof_action_done', 1)
        c.pv('prof_turns', rng.randrange(6, 10))
        c.pv('ceiling_y', max(1, row - rng.randrange(3, 5)) * 0xA0000)
        c.pv('prof_danger_prev', 1)
    else:
        c.w(V['prof_channel_action'] + c.p * 0x10 + 4 * ch, 0)
        c.w(V['prof_prev_action'] + c.p * 0x10, 0xB if kind == 'land_long' else rng.choice([8, 9]))
        c.pv('prof_fall_state', 3 if kind == 'land_long' else 2)
        c.pv('ceiling_y', 0xA0000)


PROF_OPS = []  # (action start, op address) for every opcode


def prof_ops():
    if not PROF_OPS:
        sizes = {'end': 4, 'image': 24, 'wait': 8, 'move_cell': 12, 'jump': 8, 'sound': 8, 'nudge_px': 12, 'hide': 12}
        data = json.load(open(os.path.join(REPO, 'docs/spec/data/professor.json')))
        for a in data['actions']:
            addr = int(a['address'], 16)
            for op in a['ops']:
                PROF_OPS.append((a['action'], addr))
                addr += sizes[op['op']]
    return PROF_OPS


def gen_anim(c):
    c.player()
    rng = c.rng
    ch = rng.randrange(4)
    c.pv('prof_anim_channel', ch)
    for k in range(4):
        action, addr = rng.choice(prof_ops())
        c.w(V['prof_channel_action'] + c.p * 0x10 + 4 * k, action)
        c.w(V['prof_channel_script'] + c.p * 0x10 + 4 * k, addr if rng.random() < 0.8 else 0)
    c.pv('prof_anim_wait', rng.choice([0, 0, 0, 1, 5]))
    c.pv('prof_fast', rng.randrange(2))
    c.pv('prof_col', rng.randrange(10))
    c.pv('prof_row', rng.randrange(16))
    c.pv('prof_action', rng.choice(ACTIONS))


def gen_password_decode(c):
    c.player()
    if c.rng.random() < 0.3:
        # a valid password: encode a random reachable state
        zc = c.rng.choice([0, 1, 3, 7, 0xF, 0x1F, c.rng.randrange(16)])
        zone, stage = (0, 0) if zc == 0x1F else (c.rng.randrange(5), c.rng.randrange(20))
        v = zc | ((zone << 5) | (stage << 8) if zc != 0x1F else 0)
        v |= bin(v & 0x3FFF).count('1') << 14
        v ^= 0x2AAA
        syms = [(v >> (3 * (5 - k))) & 7 for k in range(6)]
    else:
        syms = [c.rng.randrange(8) for _ in range(6)]
    for k, s in enumerate(syms):
        c.w(V['password_symbols'] + c.p * 0x18 + 4 * k, s)


def gen_password_encode(c):
    c.player()
    zc = c.rng.choice([0, 0x1F, c.rng.randrange(32)])
    c.pv('zones_cleared', zc)
    c.pv('zone', c.rng.randrange(5))
    c.pv('stage', c.rng.randrange(40))


def gen_dpad(c):
    c.player()
    c.pads(0xF000)
    for a, hi in ((0x800EEA10, 21), (0x800EEA20, 9), (0x800EEA38, 5)):
        c.w(a + 4 * c.p, c.rng.choice([0, 1, 19, 20, c.rng.randrange(hi)]))


def gen_timer(c):
    c.player()
    c.pv('stage_time', c.rng.choice([0, 9998, 9999, c.rng.randrange(10000)]))
    c.pv('stage_time_sub', c.rng.randrange(-1, 7))


def gen_number(c):
    c.player()
    rng = c.rng
    digits = rng.randrange(1, 9)
    c.args = [rng.choice([0, 7, 10, 99, 100, 12345, 9999999, rng.randrange(10 ** digits)]), digits,
              c.p * 400 + rng.randrange(0x30, 0x180), rng.randrange(200)]
    c.stack = [rng.randrange(240), rng.randrange(0x1000), rng.randrange(1, 20)]


# name -> (entry, generator, cases)
ROUTINES = {
    'piece_collides': (0x800AE4F0, gen_piece, 1000),
    'play_fall': (0x800A313C, gen_play_fall, 1000),
    'lines_find_full': (0x800AD93C, gen_lines, 300),
    'lines_remove': (0x800AD4E0, gen_lines, 400),
    'score_add_lines': (0x800AC6A8, gen_score, 200),
    'queue_advance': (0x800AE9F4, gen_queue, 500),
    'piece_input': (0x800ADE20, gen_input, 500),
    'ceiling_tick': (0x800AF490, gen_ceiling, 500),
    'ceiling_crush': (0x800AF7BC, gen_crush, 300),
    'debris_update': (0x800AFE40, gen_debris, 300),
    'prof_sense': (0x800A11E4, gen_prof, 500),
    'prof_fall_distance': (0x800A13AC, gen_prof, 500),
    'prof_think': (0x8009F50C, gen_think, 2000),
    'prof_anim_tick': (0x800A0754, gen_anim, 2000),
    'password_decode': (0x800B3AD8, gen_password_decode, 1000),
    'password_encode': (0x800B401C, gen_password_encode, 300),
    'menu_dpad_repeat': (0x800B552C, gen_dpad, 500),
    'stage_timer_tick': (0x800B0B88, gen_timer, 200),
    'number_draw': (0x800B0424, gen_number, 300),
}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('exe')
    ap.add_argument('out')
    ap.add_argument('--cases', type=int)
    ap.add_argument('--only')
    a = ap.parse_args()
    machine = Machine(a.exe)
    names = a.only.split(',') if a.only else list(ROUTINES)
    os.makedirs(a.out, exist_ok=True)
    for name in names:
        entry, gen, n = ROUTINES[name]
        n = a.cases or n
        rng = random.Random(name)
        cases = []
        for _ in range(n):
            seed = rng.randrange(1 << 32)
            machine.reset(seed)
            c = Case(machine, rng)
            c.args, c.stack = [], []
            gen(c)
            before = machine.snapshot()
            v0 = machine.call(entry, c.args, c.stack)
            after = machine.snapshot()
            cases.append({'writes': c.writes, 'args': c.args, 'stack': c.stack, 'seed': seed, 'v0': v0,
                          'changed': diff(before, after), 'rand': machine.calls, 'seedAfter': machine.seed,
                          'se': machine.se, 'bgm': machine.bgm})
        path = os.path.join(a.out, f'{name}.json.gz')
        with gzip.open(path, 'wt') as f:
            json.dump({'routine': name, 'entry': f'0x{entry:08x}', 'cases': cases}, f, separators=(',', ':'))
        print(f'{name}: {n} cases, {os.path.getsize(path)} bytes')


if __name__ == '__main__':
    sys.exit(main())
