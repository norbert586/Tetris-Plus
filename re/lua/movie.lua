-- Oracle harness: plays an input movie (docs/re/oracle-harness.md) on the original game in
-- PCSX-Redux and records a trace of the decoded game state once per logic tick.
--
-- How it drives the game:
--   * Boot: the movie's boot route presses buttons on the emulated pad, by emulator frame,
--     until PAZLE.EXE starts (route "puzzle": title, then Puzzle on the mode select).
--     Route "power" (trace version 4) presses nothing: the movie drives every program it
--     knows (PROGRAMS below) from power-on, and tick t is the frame counter itself (only the
--     programs' main loops count it, not the boot program's loader or JLOGO), so a movie can
--     run from the startup screens through the title and mode select into Puzzle Mode and back.
--     Each row then has "prog" (the program's name) and that program's fields; a row whose
--     "prog" differs from the previous row's lists all of them.
--   * In Puzzle Mode the pad is left idle and the movie's pad word is returned from PadRead
--     instead: a breakpoint right after pad_read's call to PadRead (0x80095668) sets v0. So
--     movie input is per logic tick, exact, and independent of the BIOS pad polling.
--   * Tick t is the global frame counter state+0x40 minus its value when pazle_main starts:
--     tick 1 is the main loop's first iteration. movie[t] is the pad word the logic of tick t
--     sees; it is injected by the PadRead at the end of tick t-1.
--   * The trace row for tick t is sampled at the same breakpoint: after tick t's logic and
--     drawing, before its pad read. Sounds, music requests and rand() calls are counted
--     between consecutive samples, so they belong to tick t's logic (plus the end of tick t-1's
--     main loop: bgm_poll and the per-frame rand()).
--
-- Environment:
--   TP_OUT      output directory (must exist)
--   TP_MOVIE    the movie (.tpm)
--   TP_SHOTS    ticks to screenshot, comma separated; a range first-last:every
--   TP_SAVE_AT  ticks after which to write a save state (state_TICK.sstate + .json); the state
--               also holds the input of tick TICK+1
--   TP_LOAD     a save state written by TP_SAVE_AT at tick T: start there instead of booting.
--               Inputs up to T+1 come from the saved run; the trace starts at T+2
--   TP_RAM_AT   ticks at which to dump main RAM (ram_TICK.bin); the last tick is always dumped
--   TP_VRAM_AT  ticks at which to dump VRAM (vram_TICK.bin, 1024x512 16-bit) and main RAM
--               (ram_TICK.bin) at the sample point, when the tick's ordering table is in RAM
--               and has been drawn
--   TP_REALTIME 1: keep Redux's real-time pacing (by default the run goes as fast as it can)
--   TP_SPEED    the SPU speed multiplier used otherwise (default 32)
--   TP_PADLOG   1: log PadRead's own value whenever it is non-zero (checks the pad format)
--   TP_MAIN_RAM 1: dump main RAM when each program's main starts (ram_main_NAME_COUNTER.bin)
--   TP_UNTIL    also end the run at the first recorded tick where any condition holds:
--               NAME=VALUE, NAME!=VALUE or NAME>=VALUE on a trace field, comma separated
--               (for example pieces>=5,scr!=5). Logged as "tick N: until NAME"
--   TP_SAVE_UNTIL 1: write a save state at the tick TP_UNTIL stopped on
--
-- Output: TP_OUT/trace.jsonl (re/tools/tptrace.py reads it), TP_OUT/run.log lines
-- "tick N: ..." and the files above.

local TRACE_VERSION = 4

local ffi = require('ffi')

-- Redux paces emulation by its (dummy) audio output. A higher SPU speed multiplier lets a run go
-- as fast as the host allows (about 90 ticks a second instead of 60). Emulated timing doesn't
-- change: traces are identical either way (docs/re/oracle-harness.md §6). (UseNullSync, the
-- obvious switch, hangs the emulator.)
if os.getenv('TP_REALTIME') ~= '1' then PCSX.settings.spu.Speed = tonumber(os.getenv('TP_SPEED') or '32') end
local outDir = os.getenv('TP_OUT') or '.'
local mem = PCSX.getMemPtr()
local pad = PCSX.SIO0.slots[1].pads[1]
local button = PCSX.CONSTS.PAD.BUTTON

local CTR = 0x3e668 + 0x40

-- The programs the tracer knows, by the first 16 bytes the boot program loads at 0x80094000.
--   main       the program's main function (where a run of it starts)
--   padread    the instruction after the main loop's (or pad_read's) call to PadRead: the
--              sample point, where the movie's word replaces PadRead's result
--   rand       the BIOS rand() stub; se, bgm: the program's sound effect / music calls;
--   itemLoad, itemQueue: its image uploads (immediate / queued), with player at `player`
--   ot         { active buffer variable, GsOT headers (20 bytes each) }
--   cd         CdControl, CdControlF, CdControlB; cdReport: the program's CD report callback
--   fields     its trace fields (re/lua/...); board: record PAZLE's board
-- A program without an entry runs untraced (JLOGO, the boot program's loader).
local PROGRAMS = {
    {
        name = 'PAZLE', fingerprint = '30610980306109803061098030610980',
        main = 0x800963b0, padread = 0x80095668, rand = 0x800c0c48,
        se = 0x80095778, bgm = 0x80095da8, itemLoad = 0x8009740c, itemQueue = 0x8009747c, player = 0x800eead0,
        ot = { 0x800ee484, 0x800ed2f4 }, cd = { 0x800c5ee8, 0x800c6020, 0x800c614c }, cdReport = 0x80095c5c,
        fields = 're/lua/trace_fields.lua', board = true,
    },
}
local function addPrograms(path)
    local ok, more = pcall(dofile, os.getenv('TP_REPO') .. '/' .. path)
    if not ok then return end
    for _, p in ipairs(more) do PROGRAMS[#PROGRAMS + 1] = p end
end
-- The other programs' entries (Phase 9), kept beside their field lists.
addPrograms('re/lua/programs.lua')
local PROGRAM_BY_FINGERPRINT = {}
for _, p in ipairs(PROGRAMS) do PROGRAM_BY_FINGERPRINT[p.fingerprint] = p end
local PAZLE = PROGRAMS[1]

local BITS = {
    L2 = 0x0001, R2 = 0x0002, L1 = 0x0004, R1 = 0x0008, TRIANGLE = 0x0010, CIRCLE = 0x0020,
    CROSS = 0x0040, SQUARE = 0x0080, SELECT = 0x0100, START = 0x0800, UP = 0x1000,
    RIGHT = 0x2000, DOWN = 0x4000, LEFT = 0x8000,
}

-- Boot routes: emulated-pad presses by emulator frame, from power-on to PAZLE.EXE.
-- { button, first frame, last frame, every } taps (held 4 frames) and { button, frame, hold }.
local ROUTES = {
    puzzle = {
        taps = { { 'START', 300, 3000, 90 } },
        presses = { { 'RIGHT', 3400, 4 }, { 'CROSS', 3500, 4 }, { 'CROSS', 3700, 4 } },
    },
    power = { taps = {}, presses = {}, all = true },
}

local function fail(text)
    print('error: ' .. text)
    PCSX.quit(1)
    error(text)
end

------------------------------------------------------------------------------ movie

local function parseButtons(text, where)
    local mask = 0
    local player = 0
    local names = text
    local p = text:match('^(%d):')
    if p then
        player = tonumber(p) - 1
        names = text:sub(3)
    end
    if player < 0 or player > 1 then fail(where .. ': pad must be 1 or 2') end
    for name in names:gmatch('[^+]+') do
        local bit_ = BITS[name]
        if not bit_ then fail(where .. ': unknown button ' .. name) end
        mask = bit.bor(mask, bit_)
    end
    return bit.lshift(mask, 16 * player)
end

local function loadMovie(path)
    local movie = { inputs = {}, pokes = {}, boot = 'puzzle', name = path:match('([^/]+)$') }
    local last = 0
    local n = 0
    for line in io.lines(path) do
        n = n + 1
        local where = string.format('%s:%d', path, n)
        line = line:gsub('#.*$', '')
        local words = {}
        for w in line:gmatch('%S+') do words[#words + 1] = w end
        if #words == 0 then
        elseif words[1] == 'tpm' then
            if words[2] ~= '1' then fail(where .. ': unsupported movie version') end
            movie.version = 1
        elseif words[1] == 'boot' then
            movie.boot = words[2]
        elseif words[1] == 'end' then
            movie.last = tonumber(words[2])
        elseif words[1] == 'mark' then
        elseif words[1] == 'poke' then
            -- poke TICK ADDRESS VALUE [SIZE]: write memory right after tick TICK is recorded
            local t, address, value = tonumber(words[2]), tonumber(words[3]), tonumber(words[4])
            local size = tonumber(words[5] or '4')
            if not t or not address or not value or (size ~= 1 and size ~= 2 and size ~= 4) then
                fail(where .. ': expected poke TICK ADDRESS VALUE [1|2|4]')
            end
            movie.pokes[t] = movie.pokes[t] or {}
            table.insert(movie.pokes[t], { address = address, value = value, size = size })
        else
            local at = words[1]
            local t = at:sub(1, 1) == '+' and last + tonumber(at:sub(2)) or tonumber(at)
            local hold = tonumber(words[2])
            if not t or not hold or not words[3] then fail(where .. ': expected TICK HOLD BUTTONS') end
            if t < last then fail(where .. ': events must be in tick order') end
            if t < 2 then fail(where .. ': the first tick with input is 2') end
            local mask = parseButtons(words[3], where)
            for k = t, t + hold - 1 do movie.inputs[k] = bit.bor(movie.inputs[k] or 0, mask) end
            last = t
        end
    end
    if movie.version ~= 1 then fail(path .. ': missing "tpm 1"') end
    if not movie.last then fail(path .. ': missing "end TICK"') end
    if not ROUTES[movie.boot] then fail(path .. ': unknown boot route ' .. movie.boot) end
    return movie
end

local moviePath = os.getenv('TP_MOVIE') or fail('TP_MOVIE is not set')
local movie = loadMovie(moviePath)
local route = ROUTES[movie.boot]

local function tickSet(text)
    local set = {}
    for entry in (text or ''):gmatch('[^,]+') do
        local first, last, every = entry:match('^(%d+)-(%d+):(%d+)$')
        if first then
            for t = tonumber(first), tonumber(last), tonumber(every) do set[t] = true end
        else
            set[tonumber(entry)] = true
        end
    end
    return set
end

local shotTicks = tickSet(os.getenv('TP_SHOTS'))
local saveTicks = tickSet(os.getenv('TP_SAVE_AT'))
local ramTicks = tickSet(os.getenv('TP_RAM_AT'))
local vramTicks = tickSet(os.getenv('TP_VRAM_AT'))
local padLog = os.getenv('TP_PADLOG') == '1'
local loadPath = os.getenv('TP_LOAD')
local saveUntil = os.getenv('TP_SAVE_UNTIL') == '1'
local untils = {}
for entry in (os.getenv('TP_UNTIL') or ''):gmatch('[^,]+') do
    local name, op, value = entry:match('^([%w_]+)([!>]?=)(%-?%d+)$')
    if not name then fail('bad TP_UNTIL entry: ' .. entry) end
    untils[#untils + 1] = { name = name, op = op, value = tonumber(value), text = entry }
end

------------------------------------------------------------------------------ memory

local function phys(address) return bit.band(address, 0x1fffff) end

local readers = {
    s32 = function(a) return ffi.cast('int32_t*', mem + a)[0] end,
    u32 = function(a) return tonumber(ffi.cast('uint32_t*', mem + a)[0]) end,
    s16 = function(a) return ffi.cast('int16_t*', mem + a)[0] end,
    u16 = function(a) return ffi.cast('uint16_t*', mem + a)[0] end,
    u8 = function(a) return mem[a] end,
}
local sizes = { s32 = 4, u32 = 4, s16 = 2, u16 = 2, u8 = 1 }

local function loadFields(path)
    local list = {}
    for _, f in ipairs(dofile(os.getenv('TP_REPO') .. '/' .. path)) do
        local name, address, type_, count, stride = f[1], f[2], f[3], f[4], f[5]
        list[#list + 1] = { name = name, address = phys(address), read = readers[type_], count = count,
                            stride = stride or sizes[type_] }
    end
    return list
end
for _, p in ipairs(PROGRAMS) do p.fieldList = loadFields(p.fields) end
local fields = PAZLE.fieldList

local function slotFingerprint()
    local bytes = {}
    for i = 0, 15 do bytes[#bytes + 1] = string.format('%02x', mem[0x94000 + i]) end
    return table.concat(bytes)
end
-- The program in the slot (nil: none the tracer knows), looked up again whenever the slot's
-- first word changes (a program is loaded mid-frame).
local slotCache, slotWord = nil, nil
local function slotProgram()
    local w = readers.u32(0x94000)
    if w ~= slotWord then
        slotCache = PROGRAM_BY_FINGERPRINT[slotFingerprint()]
        slotWord = w
    end
    return slotCache
end

-- Board, player 1: rows 0-15 as one string, '.' empty, 1-9, a-z for 10-35, '#' 0xFFFF.
-- Any other value is a format error and stops the run.
local BOARD = phys(0x800edca0)
local CELL = {}
CELL[0] = '.'
for v = 1, 9 do CELL[v] = tostring(v) end
for v = 10, 35 do CELL[v] = string.char(87 + v) end
CELL[0xffff] = '#'

local function readBoard()
    local cells = ffi.cast('int32_t*', mem + BOARD)
    local out = {}
    for i = 0, 159 do
        local c = CELL[cells[i]]
        if not c then fail(string.format('board cell %d holds %d', i, cells[i])) end
        out[i + 1] = c
    end
    return table.concat(out)
end

------------------------------------------------------------------------------ trace

local trace = io.open(outDir .. '/trace.jsonl', 'w')
local function jsonValue(v)
    if type(v) == 'table' then
        local parts = {}
        for i, x in ipairs(v) do parts[i] = jsonValue(x) end
        return '[' .. table.concat(parts, ',') .. ']'
    elseif type(v) == 'string' then
        return '"' .. v .. '"'
    end
    return string.format('%d', v)
end

local EXTRA_FIELDS = '"rand","se","bgm","up","ot","fb","vs","kon","koff","spu","rev","cd","cdr"'
local function fieldNames(p)
    local names = {}
    for i, f in ipairs(p.fieldList) do names[i] = '"' .. f.name .. '"' end
    if p.board then names[#names + 1] = '"board"' end
    return table.concat(names, ',') .. ',' .. EXTRA_FIELDS
end
do
    -- "fields": Puzzle Mode's; with route "power" also "programs": each program's fields.
    local programs = {}
    if route.all then
        for _, p in ipairs(PROGRAMS) do programs[#programs + 1] = string.format('"%s":["prog",%s]', p.name, fieldNames(p)) end
    end
    trace:write(string.format('{"tptrace":%d,"movie":"%s","boot":"%s","fields":[%s]%s}\n',
                              TRACE_VERSION, movie.name, movie.boot, fieldNames(PAZLE),
                              route.all and (',"programs":{' .. table.concat(programs, ',') .. '}') or ''))
end

local previous = {}
local function sameValue(a, b)
    if type(a) ~= 'table' then return a == b end
    if type(b) ~= 'table' or #a ~= #b then return false end
    for i = 1, #a do if a[i] ~= b[i] then return false end end
    return true
end

-- Per-tick event lists, filled by the breakpoints below.
local randCalls, sounds, music, uploads = 0, {}, {}, {}
-- Audio events (trace version 3, docs/re/audio.md): SPU key-ons and key-offs, CD commands and
-- CD position reports, filled by the breakpoints in the audio section below.
local keyOns, keyOffs, cdCommands, cdReports = {}, {}, {}, {}
-- Vblanks since the previous sample: libsnd's flush runs once per vblank, not per tick.
local vblanks = 0
local spuGlobals, spuReverb -- functions, defined below

-- Frame hashes: FNV-1a over 32-bit (ot) or 16-bit (fb) words, kept as signed 32-bit numbers.
-- h * 16777619 mod 2^32 is split as (h << 24) + h * 403 so the product stays exact.
local function fnv(h, w)
    h = bit.bxor(h, w)
    return bit.tobit(bit.lshift(h, 24) + h * 403)
end
local FNV_BASIS = bit.tobit(0x811c9dc5)

-- ot: the GPU commands of the frame just built, in drawing order: the chain of ordering-table
-- buffer 0x800EE484 (GsOT headers at 0x800ED2F4, 20 bytes each; the chain starts at ->tag).
-- Every packet's words after its link word are hashed; link words are RAM addresses.
local function hashOrderingTable(p)
    local buffer = readers.u32(phys(p.ot[1]))
    local tag = readers.u32(phys(p.ot[2] + 20 * buffer + 16))
    local address, h, n = bit.band(tag, 0xffffff), FNV_BASIS, 0
    while address ~= 0xffffff do
        local head = readers.u32(phys(address))
        for k = 1, bit.rshift(head, 24) do h = fnv(h, readers.s32(phys(address + 4 * k))) end
        address = bit.band(head, 0xffffff)
        n = n + 1
        if n > 100000 then fail('ordering table loops') end
    end
    return h
end

-- fb: the 320x240 frame the GPU just drew, mask bit included. The ordering table of buffer b
-- (0x800EE484) is drawn after GsSwapDispBuff, into the other display buffer: (0, 240 * (1 - b)).
local function hashFrame(p)
    local buffer = 1 - readers.u32(phys(p.ot[1]))
    local vram = PCSX.GPU.getVRAM()
    local px = ffi.cast('const uint16_t*', vram.data)
    local h = FNV_BASIS
    for y = 240 * buffer, 240 * buffer + 239 do
        local row = px + y * 1024
        for x = 0, 319 do h = fnv(h, row[x]) end
    end
    return h
end

-- One trace line: the tick and every value that changed since the previous line (all of them
-- on the first line). Lists of events are written whenever non-empty.
local recordedProgram = nil
local mainSeed = nil -- the BIOS seed when the running program's main started
local function record(t, p)
    local parts = { '"t":' .. t }
    local function put(name, value)
        if not sameValue(previous[name], value) then
            parts[#parts + 1] = '"' .. name .. '":' .. jsonValue(value)
            previous[name] = value
        end
    end
    if route.all then
        if p ~= recordedProgram then
            previous = {}
            -- The BIOS seed when this program's main started: loading times decide it, so a
            -- replay of the port injects it (the boot program's own rand() calls are skipped).
            parts[#parts + 1] = '"mainseed":' .. jsonValue(mainSeed or 0)
        end
        put('prog', p.name)
    end
    recordedProgram = p
    for _, f in ipairs(p.fieldList) do
        if f.count then
            local values = {}
            for i = 0, f.count - 1 do values[i + 1] = f.read(f.address + i * f.stride) end
            put(f.name, values)
        else
            put(f.name, f.read(f.address))
        end
    end
    if p.board then put('board', readBoard()) end
    put('rand', randCalls)
    if #sounds > 0 then parts[#parts + 1] = '"se":' .. jsonValue(sounds) end
    if #music > 0 then parts[#parts + 1] = '"bgm":' .. jsonValue(music) end
    if #uploads > 0 then parts[#parts + 1] = '"up":' .. jsonValue(uploads) end
    put('ot', hashOrderingTable(p))
    put('fb', hashFrame(p))
    put('vs', vblanks)
    if #keyOns > 0 then parts[#parts + 1] = '"kon":' .. jsonValue(keyOns) end
    if #keyOffs > 0 then parts[#parts + 1] = '"koff":' .. jsonValue(keyOffs) end
    put('spu', spuGlobals())
    put('rev', spuReverb())
    if #cdCommands > 0 then parts[#parts + 1] = '"cd":' .. jsonValue(cdCommands) end
    if #cdReports > 0 then parts[#parts + 1] = '"cdr":' .. jsonValue(cdReports) end
    trace:write('{' .. table.concat(parts, ',') .. '}\n')
    if TpAudioLog then TpAudioLog('sample') end
    randCalls, sounds, music, uploads = 0, {}, {}, {}
    keyOns, keyOffs, cdCommands, cdReports = {}, {}, {}, {}
    vblanks = 0
end

------------------------------------------------------------------------------ run state

local frame = 0
local active = false   -- tracing: PAZLE.EXE's main loop is running (route "power": from power-on)
local base = nil       -- state+0x40 when pazle_main started (route "power": 0)
local tick = -1        -- last tick seen
local resumeAfter = -1 -- record ticks after this one
local quitCode = nil
local pending = {}     -- work for the next vblank (screenshots, save states)

local function log(text) print(string.format('tick %d: %s', tick, text)) end

local function dumpRam(name)
    local file = Support.File.open(outDir .. '/' .. name, 'TRUNCATE')
    file:write(mem, 0x200000)
    file:close()
end

local function dumpVram(name)
    local file = Support.File.open(outDir .. '/' .. name, 'TRUNCATE')
    file:writeMoveSlice(PCSX.GPU.getVRAM())
    file:close()
end

local function screenshot(t)
    local shot = PCSX.GPU.takeScreenShot()
    local name = string.format('%s/shot_t%05d_%dx%d_%s.raw', outDir, t, shot.width, shot.height,
                               shot.bpp == 0 and '16' or '24')
    local file = Support.File.open(name, 'TRUNCATE')
    file:writeMoveSlice(shot.data)
    file:close()
end

local function saveState(t)
    local name = string.format('%s/state_%05d', outDir, t)
    local file = Support.File.open(name .. '.sstate', 'TRUNCATE')
    file:writeMoveSlice(PCSX.createSaveState())
    file:close()
    local side = io.open(name .. '.json', 'w')
    side:write(string.format('{"tick":%d,"base":%d,"movie":"%s","spu":%s}\n', t, base, movie.name, TpSpuSnapshot()))
    side:close()
    log('save state ' .. name .. '.sstate')
end

------------------------------------------------------------------------------ breakpoints
-- Globals: Redux removes a breakpoint once its Lua handle is collected.

TpMovieBreakpoints = {}
local function addExec(address, name, fn)
    table.insert(TpMovieBreakpoints, PCSX.addBreakpoint(address, 'Exec', 4, name, function()
        fn(PCSX.getRegisters())
        return true -- keep the breakpoint
    end))
end

-- The breakpoints of every known program; each handler only acts while its program is in
-- the slot, since programs share addresses.
local function onProgram(p, address, name, fn)
    if address then addExec(address, name, function(regs) if slotProgram() == p then fn(regs) end end) end
end

local function startTracing()
    active = true
    for _, value in pairs(button) do pad.clearOverride(value) end
end
if route.all and not loadPath then
    base = 0
    startTracing()
end

-- The sample point (the main loop's PadRead) of tick t: record, then inject movie[t + 1].
local function onPadRead(p, regs)
    if not active or (not route.all and p ~= PAZLE) then return end
    local t = readers.u32(CTR) - base
    if t ~= tick then
        if t ~= tick + 1 and tick >= 0 then log(string.format('warning: tick jumped to %d', t)) end
        tick = t
        -- After a save state the first tick's sounds and rand() calls were partly counted
        -- before the save, so the trace resumes one tick later.
        if t > resumeAfter then
            record(t, p)
        else
            randCalls, sounds, music, uploads = 0, {}, {}, {}
            keyOns, keyOffs, cdCommands, cdReports = {}, {}, {}, {}
            vblanks = 0
        end
        if t > resumeAfter and not quitCode then
            for _, u in ipairs(untils) do
                local v = previous[u.name]
                if type(v) == 'table' then v = v[1] end
                if v ~= nil and ((u.op == '=' and v == u.value) or (u.op == '!=' and v ~= u.value) or (u.op == '>=' and v >= u.value)) then
                    log('until ' .. u.text)
                    if saveUntil then pending.save = t end
                    dumpRam('ram_end.bin')
                    quitCode = 0
                    break
                end
            end
        end
        if shotTicks[t] then pending.shot = t end
        if saveTicks[t] then pending.save = t end
        if ramTicks[t] or vramTicks[t] then dumpRam(string.format('ram_%05d.bin', t)) end
        if vramTicks[t] then dumpVram(string.format('vram_%05d.bin', t)) end
        for _, poke in ipairs(movie.pokes[t] or {}) do
            local a = phys(poke.address)
            if poke.size == 4 then ffi.cast('uint32_t*', mem + a)[0] = bit.tobit(poke.value)
            elseif poke.size == 2 then ffi.cast('uint16_t*', mem + a)[0] = poke.value
            else mem[a] = poke.value end
            log(string.format('poke 0x%08x = %d', poke.address, poke.value))
        end
        if t >= movie.last then
            dumpRam('ram_end.bin')
            log('done')
            quitCode = 0
        end
    else
        log('warning: pad_read called twice in one tick')
    end
    if padLog and regs.GPR.n.v0 ~= 0 then log(string.format('PadRead returned 0x%08x', regs.GPR.n.v0)) end
    regs.GPR.n.v0 = movie.inputs[t + 1] or 0
end

-- Image uploads: item_load(n) uploads at once, FUN_8009747C(n) queues an upload for the end of
-- the frame (up to 4 a frame). Logged as n + 0x10000 * player, plus 0x100000 when queued.
-- TP_UPLOAD_LOG=1 also logs each call's return address ("tick N: up ITEM from RA").
local uploadLog = os.getenv('TP_UPLOAD_LOG') == '1'
-- TP_MAIN_RAM=1 dumps main RAM when each program's main starts (ram_main_NAME_COUNTER.bin):
-- the state a port of that program starts from.
local mainRam = os.getenv('TP_MAIN_RAM') == '1'
for _, p in ipairs(PROGRAMS) do
    onProgram(p, p.main, 'tp_main_' .. p.name, function()
        print(string.format('frame %d: %s main, counter %d, seed 0x%08x', frame, p.name, readers.u32(CTR), readers.u32(phys(0x800083a4))))
        mainSeed = readers.u32(phys(0x800083a4))
        if mainRam then dumpRam(string.format('ram_main_%s_%05d.bin', p.name, readers.u32(CTR))) end
        if p == PAZLE and not route.all and not active then
            base = readers.u32(CTR)
            startTracing()
        end
    end)
    onProgram(p, p.padread, 'tp_padread_' .. p.name, function(regs) onPadRead(p, regs) end)
    onProgram(p, p.rand, 'tp_rand', function()
        if active then randCalls = randCalls + 1 end
    end)
    onProgram(p, p.se, 'tp_se', function(regs)
        if active then sounds[#sounds + 1] = regs.GPR.n.a0 end
    end)
    onProgram(p, p.bgm, 'tp_bgm', function(regs)
        if active then music[#music + 1] = regs.GPR.n.a0 end
    end)
    onProgram(p, p.itemLoad, 'tp_item_load', function(regs)
        if not active then return end
        uploads[#uploads + 1] = regs.GPR.n.a0 + 0x10000 * (p.player and readers.u32(phys(p.player)) or 0)
        if uploadLog then log(string.format('up %d from 0x%08x', regs.GPR.n.a0, regs.GPR.n.ra)) end
    end)
    onProgram(p, p.itemQueue, 'tp_item_queue', function(regs)
        if not active then return end
        uploads[#uploads + 1] = regs.GPR.n.a0 + 0x10000 * (p.player and readers.u32(phys(p.player)) or 0) + 0x100000
        if uploadLog then log(string.format('upq %d from 0x%08x', regs.GPR.n.a0, regs.GPR.n.ra)) end
    end)
end

------------------------------------------------------------------------------ audio
-- Trace version 3. Redux doesn't expose the SPU's registers to Lua, so a write breakpoint on
-- the whole register block (0x1F801C00-0x1F801FFF) keeps a copy of everything the program
-- writes: the breakpoint fires before the store, which is decoded from the instruction at pc
-- (sb/sh/sw; sw writes two registers). Reads (ENVX, the current volumes) aren't needed.
--   kon  each key-on: voice, then its registers when KON is written: volume left, right,
--        pitch, start address, ADSR1, ADSR2, repeat address (libsnd's SpuVmFlush, run by the
--        VSync interrupt, writes them all just before KON)
--   koff each non-zero write to KOFF: voices 0-15 low, 16-23 high
--   spu  main volume L/R, reverb volume L/R, CD volume L/R, external volume L/R, SPUCNT, EON
--        (24 bits), PMON, NON, reverb work area start: the mix state, written when it changes
--   rev  the 32 reverb registers (0x1DC0-0x1DFF)
--   cd   CdControl / CdControlF / CdControlB calls: command, then the parameter bytes for
--        Setloc (3), Play (1, when given) and Setmode (1)
--   cdr  each call of bgm_report_callback (0x80095C5C): interrupt type, then the result bytes
--        stat, track, index, minute, second (+0x80: relative), sector
local rom = PCSX.getRomPtr()
-- TP_AUDIO_LOG=1 writes audio.log: "TICK sample|cd|cdr CYCLE ..." with the CPU cycle counter,
-- to time CD commands and reports within a tick (docs/re/audio.md).
local audioLog = os.getenv('TP_AUDIO_LOG') == '1' and io.open(outDir .. '/audio.log', 'w') or nil
function TpAudioLog(kind, text)
    if audioLog then audioLog:write(string.format('%d %s %s %s\n', tick, kind, (tostring(PCSX.getCPUCycles()):gsub('ULL', '')), text or '')) end
end
local spuRegs = {}
for i = 0, 0x1ff do spuRegs[i] = 0 end
local function spuReg(offset) return spuRegs[bit.rshift(offset, 1)] end
local function setSpuReg(offset, value)
    local r = bit.rshift(offset, 1)
    spuRegs[r] = value
    if not active then return end
    if offset == 0x188 or offset == 0x18a then
        local first = offset == 0x188 and 0 or 16
        for b = 0, 15 do
            if bit.band(value, bit.lshift(1, b)) ~= 0 then
                local v = first + b
                local o = v * 16
                TpAudioLog('kon', tostring(v))
                keyOns[#keyOns + 1] = { v, spuReg(o), spuReg(o + 2), spuReg(o + 4), spuReg(o + 6), spuReg(o + 8),
                                        spuReg(o + 10), spuReg(o + 14) }
            end
        end
    elseif (offset == 0x18c or offset == 0x18e) and value ~= 0 then
        keyOffs[#keyOffs + 1] = offset == 0x18c and value or value * 65536
    end
end
-- The register copy travels with save states (their side file), since a run started from one
-- never sees the writes made before it.
function TpSpuSnapshot()
    local values = {}
    for i = 0, 0x1ff do values[i + 1] = spuRegs[i] end
    return '[' .. table.concat(values, ',') .. ']'
end
function TpSpuRestore(text)
    if not text then return end
    local i = 0
    for v in text:gmatch('%d+') do spuRegs[i] = tonumber(v); i = i + 1 end
end
spuGlobals = function()
    return { spuReg(0x180), spuReg(0x182), spuReg(0x184), spuReg(0x186), spuReg(0x1b0), spuReg(0x1b2),
             spuReg(0x1b4), spuReg(0x1b6), spuReg(0x1aa), spuReg(0x198) + 65536 * spuReg(0x19a),
             spuReg(0x190) + 65536 * spuReg(0x192), spuReg(0x194) + 65536 * spuReg(0x196), spuReg(0x1a2) }
end
spuReverb = function()
    local values = {}
    for k = 0, 31 do values[k + 1] = spuReg(0x1c0 + 2 * k) end
    return values
end

local STORES = { [0x28] = 1, [0x29] = 2, [0x2b] = 4 }
TpSpuBreakpoint = PCSX.addBreakpoint(0x1f801c00, 'Write', 0x400, 'tp_spu', function(address)
    local regs = PCSX.getRegisters()
    local pc = regs.pc
    local insn
    if bit.band(pc, 0x1fc00000) == 0x1fc00000 then
        insn = tonumber(ffi.cast('uint32_t*', rom + bit.band(pc, 0x7ffff))[0])
    else
        insn = readers.u32(phys(pc))
    end
    local size = STORES[bit.rshift(insn, 26)]
    if not size then fail(string.format('SPU write from a non-store at 0x%08x', regs.pc)) end
    local value = regs.GPR.r[bit.band(bit.rshift(insn, 16), 31)]
    local offset = bit.band(address, 0x3fe)
    if size == 4 then
        setSpuReg(offset, bit.band(value, 0xffff))
        setSpuReg(offset + 2, bit.band(bit.rshift(value, 16), 0xffff))
    elseif size == 2 then
        setSpuReg(offset, bit.band(value, 0xffff))
    else
        local old = spuReg(offset)
        local shift = bit.band(address, 1) * 8
        setSpuReg(offset, bit.bor(bit.band(old, bit.bnot(bit.lshift(0xff, shift))), bit.lshift(bit.band(value, 0xff), shift)))
    end
    return true
end)

local CD_PARAMS = { [0x02] = 3, [0x0e] = 1 } -- libcd sends Play (0x03) without a parameter
for _, p in ipairs(PROGRAMS) do
    for _, address in ipairs(p.cd or {}) do
        onProgram(p, address, 'tp_cd', function(regs)
            if not route.all and p ~= PAZLE then return end
            local com = bit.band(regs.GPR.n.a0, 0xff)
            local entry = { com }
            if regs.GPR.n.a1 ~= 0 and CD_PARAMS[com] then
                local a = phys(regs.GPR.n.a1)
                for k = 0, CD_PARAMS[com] - 1 do entry[#entry + 1] = mem[a + k] end
            end
            cdCommands[#cdCommands + 1] = entry
            TpAudioLog('cd', table.concat(entry, ' '))
        end)
    end
    onProgram(p, p.cdReport, 'tp_cd_report', function(regs)
        if not route.all and p ~= PAZLE then return end
        local entry = { regs.GPR.n.a0 }
        if regs.GPR.n.a1 ~= 0 then
            local a = phys(regs.GPR.n.a1)
            for k = 0, 5 do entry[#entry + 1] = mem[a + k] end
        end
        cdReports[#cdReports + 1] = entry
        TpAudioLog('cdr', table.concat(entry, ' '))
    end)
end

------------------------------------------------------------------------------ per vblank

local function applyRoute()
    for _, value in pairs(button) do pad.clearOverride(value) end
    for _, tap in ipairs(route.taps) do
        local name, first, last, every = tap[1], tap[2], tap[3], tap[4]
        if frame >= first and frame <= last and (frame - first) % every < 4 then pad.setOverride(button[name]) end
    end
    for _, press in ipairs(route.presses) do
        local name, at, hold = press[1], press[2], press[3]
        if frame >= at and frame < at + hold then pad.setOverride(button[name]) end
    end
end

TpMovieListener = PCSX.Events.createEventListener('GPU::Vsync', function()
    frame = frame + 1
    if active then
        vblanks = vblanks + 1
        TpAudioLog('vsync')
    end
    if loadPath and frame == 1 then
        local side = io.open((loadPath:gsub('%.sstate$', '.json'))):read('*a')
        tick = tonumber(side:match('"tick":(%d+)'))
        resumeAfter = tick + 1
        base = tonumber(side:match('"base":(%d+)'))
        TpSpuRestore(side:match('"spu":%[([%d,]*)%]'))
        PCSX.loadSaveState(Support.File.open(loadPath, 'READ'))
        active = true
        previous = {}
        print(string.format('frame %d: loaded %s at tick %d', frame, loadPath, tick))
        return
    end
    if not active and not loadPath then applyRoute() end
    if active and not route.all and slotProgram() ~= PAZLE then
        log('PAZLE.EXE has exited')
        dumpRam('ram_end.bin')
        trace:close()
        PCSX.quit(0)
        return
    end
    if pending.shot then screenshot(pending.shot) end
    if pending.save then saveState(pending.save) end
    pending = {}
    if quitCode then
        trace:close()
        PCSX.quit(quitCode)
        return
    end
    if frame > 200000 then fail('ran 200,000 frames without reaching the end tick') end
end)
