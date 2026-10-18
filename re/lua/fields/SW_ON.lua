-- SW_ON.EXE's trace fields (re/lua/movie.lua, route "power"): the shared ones, then its own
-- (docs/re/sw_on.md).
local fields = dofile(os.getenv('TP_REPO') .. '/re/lua/fields/common.lua')
local S = 0x8003e668
for _, f in ipairs({
    { 'pad', 0x800bacc2, 'u16' },        -- pad 1 held
    { 'padp', 0x800bacc4, 'u16' },       -- pad 1 newly pressed
    { 'slot', 0x800b682c, 'u32' },       -- the card slot being checked (0: slot 1, 1: slot 2)
    { 'slotres', 0x800b8928, 's32', 2 }, -- each slot's card check result
    { 'cardres', 0x800b6894, 's32' },    -- the last card call's result
    { 'used', 0x800b6890, 's32' },       -- blocks in use on the card checked
    { 'ev', 0x800b5c58, 's32' },         -- the last libcard event
    { 'timer', S + 0x1fd0c, 's32' },     -- the copyright screen's timer
    { 'nosave', S + 0x4b538, 's32' },    -- 1: no save file loaded or written
    { 'oy', S + 0x60, 's32' },           -- object 0's y (the copyright text's scroll)
    { 'oimg', S + 0x80, 'u32', 4, 0x7c },-- objects 0-3's image
    { 'cursor', S + 0x1a0, 's32' },      -- yes/no cursor (object 2)
    { 'save', S + 0x4ad84, 'u32', 480 }, -- the saved data block (0x780 bytes)
}) do fields[#fields + 1] = f end
return fields
