-- Trace fields every program shares (re/lua/movie.lua, route "power"): the boot program's
-- shared state block (docs/re/static-bootstrap.md §1). A program's own field list starts with
-- these: `local fields = dofile(os.getenv('TP_REPO') .. '/re/lua/fields/common.lua')`.
local S = 0x8003e668
return {
    { 'ctr', S + 0x40, 'u32' },          -- global frame counter (+1 per tick)
    { 'seed', 0x800083a4, 'u32' },       -- BIOS rand() seed (OpenBIOS's location)
    { 'next', S + 0x48, 'u32' },         -- next program for the boot loader
    { 'param', S + 0x4c, 'u32' },        -- its parameter
    { 'phase', S + 0x50, 'u32' },        -- phase: the running program's top-level state
    { 'subphase', S + 0x54, 'u32' },
    { 'exit', S + 0x1fcf4, 'u32' },      -- exit flag
    { 'scr', S + 0x4b508, 'u32', 2 },    -- screen word per player
    { 'step', S + 0x4b510, 'u32', 2 },   -- step word per player
}
