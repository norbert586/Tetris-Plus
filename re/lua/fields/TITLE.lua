-- TITLE.EXE's trace fields (re/lua/movie.lua, route "power"): the shared ones, then its own.
-- Addresses and meanings: docs/re/title.md.
local S = 0x8003e668
local fields = dofile(os.getenv('TP_REPO') .. '/re/lua/fields/common.lua')
local function add(f) fields[#fields + 1] = f end

-- pads: held / newly pressed, pad 1 and pad 2
add({ 'pad', 0x800b7066, 'u16' })
add({ 'padp', 0x800b7068, 'u16' })
add({ 'pad2', 0x800b706c, 'u16' })
add({ 'padp2', 0x800b706e, 'u16' })
-- the title's timer and flags
add({ 'timer', 0x800b4318, 's32' })
add({ 'attract', S + 0x4b540, 's32' })    -- which demo the timeout runs: 0 HOW_N, 1 HOW_VS
add({ 'twop', S + 0x4b53c, 's32' })
-- sprite objects 0-71 and 100: image, x, y
add({ 'oimg', S + 0x5c + 0x24, 's32', 72, 0x7c })
add({ 'ox', S + 0x5c, 's32', 72, 0x7c })
add({ 'oy', S + 0x5c + 0x04, 's32', 72, 0x7c })
add({ 'oimg100', S + 0x5c + 100 * 0x7c + 0x24, 's32' })
-- sound: bgm_request's bookkeeping (player, id, wanted per player)
add({ 'bgmcur', 0x800b4294, 's32', 4 })
return fields
