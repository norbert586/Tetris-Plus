-- RANKING.EXE's trace fields (re/lua/movie.lua, route "power"): the shared ones, then its own.
-- Addresses and meanings: docs/re/ranking.md.
local S = 0x8003e668
local fields = dofile(os.getenv('TP_REPO') .. '/re/lua/fields/common.lua')
local function add(f) fields[#fields + 1] = f end
local function obj(field) return S + 0x5c + field end

-- pads: held / newly pressed, pad 1 and pad 2
add({ 'pad', 0x800b52ee, 'u16' })
add({ 'padp', 0x800b52f0, 'u16' })
add({ 'pad2', 0x800b52f4, 'u16' })
add({ 'padp2', 0x800b52f6, 'u16' })
-- soft reset (Start + Select held): ticks held, pad 1 and pad 2
add({ 'reset', 0x800b24e4, 's32', 2 })
-- the ranking's own state
add({ 'wait', 0x800b2534, 's32' })          -- phase 5: ticks shown
add({ 'off', 0x800b2538, 's32', 2 })        -- phase 3: the row being built's x / y offset (16.16)
add({ 'buf', 0x800b25c8, 's32' })           -- GsGetActiveBuff this tick
-- the records it shows (shared state block): 2 tables of 5 entries, 12 bytes each
add({ 'rec', S + 0x4ae60, 'u32', 30 })
-- sprite objects 0-419: image, position (the tables use objects 99-418)
add({ 'oimg', obj(0x24), 's32', 420, 0x7c })
add({ 'ox', obj(0x00), 's32', 420, 0x7c })
add({ 'oy', obj(0x04), 's32', 420, 0x7c })
add({ 'ovx', obj(0x38), 's32', 32, 0x7c })
return fields
