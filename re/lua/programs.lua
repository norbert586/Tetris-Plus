-- The programs the movie tracer (re/lua/movie.lua) can trace (docs/re/shell.md §6). Every
-- program loads at 0x80094000, so the tracer tells them apart by the first 16 bytes there.
-- For each: its main loop's hooks (the instruction after the main loop's PadRead call, where the
-- trace samples and the movie's pad word is injected; the BIOS rand() stub; se_play and
-- bgm_request; image uploads; the CD report callback; the libcd calls), its ordering tables (the active-buffer
-- variable and the GsOT headers, 20 bytes each) and its traced fields, as in trace_fields.lua.
-- Addresses come from the decompiles (CLAUDE.md "Decompile a whole EXE").

local S = 0x8003e668 -- the boot program's shared state block

-- Fields every program other than PAZLE records (PAZLE's are trace_fields.lua's).
local function common(pad)
    return {
        { 'ctr', S + 0x40, 'u32' },
        { 'seed', 0x800083a4, 'u32' },
        { 'pad', pad, 'u16' },              -- P1 held, as this tick's logic saw it
        { 'padp', pad + 2, 'u16' },         -- P1 newly pressed
        { 'pad2', pad + 6, 'u16' },
        { 'padp2', pad + 8, 'u16' },
        { 'next', S + 0x48, 'u32', 4 },     -- next program and its parameters (+0x48 to +0x54)
        { 'exit', S + 0x1fcf4, 'u32' },
        { 'screens', S + 0x4b508, 'u32', 12 }, -- both players' screen and step words
    }
end

local function with(list, extra)
    for _, f in ipairs(extra) do list[#list + 1] = f end
    return list
end

return {
    PAZLE = {
        fingerprint = '30610980306109803061098030610980',
        main = 0x800963b0,
        afterPadRead = 0x80095668,
        rand = 0x800c0c48,
        sePlay = 0x80095778,
        bgmRequest = 0x80095da8,
        itemLoad = 0x8009740c,
        itemQueue = 0x8009747c,
        player = 0x800eead0,
        cdReport = 0x80095c5c,
        cd = { 0x800c5ee8, 0x800c6020, 0x800c614c }, -- CdControl, CdControlF, CdControlB
        otBuffer = 0x800ee484,
        otHeaders = 0x800ed2f4,
        board = true,
        -- fields: trace_fields.lua
    },
    RANKING = {
        fingerprint = 'a8680980c8680980f4680980fc680980',
        main = 0x800956c0,
        afterPadRead = 0x80094b64,
        rand = 0x80097ab4,
        cdReport = 0x8009507c,
        cd = { 0x8009cbf8, 0x8009cd30, 0x8009ce5c },
        otBuffer = 0x800b25c8,
        otHeaders = 0x800b25d8,
        fields = with(common(0x800b52ee), {
            { 'vars', 0x800b2528, 's32', 6 },      -- gp+0x4C..+0x60: the step counters, panel offsets
            { 'reset', 0x800b24e4, 's32', 2 },     -- soft reset counters
        }),
    },
}
