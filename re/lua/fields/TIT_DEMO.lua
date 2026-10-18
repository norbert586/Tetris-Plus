-- TIT_DEMO.EXE's trace fields (re/lua/movie.lua, route "power"): the shared ones, then its own.
-- Addresses and meanings: docs/re/title.md.
local S = 0x8003e668
local fields = dofile(os.getenv('TP_REPO') .. '/re/lua/fields/common.lua')
local function add(f) fields[#fields + 1] = f end

-- pads: held / newly pressed, pad 1 and pad 2
add({ 'pad', 0x800b8ba2, 'u16' })
add({ 'padp', 0x800b8ba4, 'u16' })
add({ 'pad2', 0x800b8ba8, 'u16' })
add({ 'padp2', 0x800b8baa, 'u16' })
-- the story's state machine (phase 1): scene step, caption step, their counters
add({ 'scene', 0x800b5cf8, 's32' })
add({ 'caption', 0x800b5d08, 's32' })
add({ 'vars', 0x800b5d18, 's32', 17 })    -- 0x800B5D18-0x800B5D58: caption cursor, timers, scene counters
add({ 'blink', 0x800b5e7c, 's32' })       -- the scroll's frame countdown
-- sprite objects 0-15 and the caption letters' first 8 (100-107): image, x, y, fade level
add({ 'oimg', S + 0x5c + 0x24, 's32', 16, 0x7c })
add({ 'ox', S + 0x5c, 's32', 16, 0x7c })
add({ 'oy', S + 0x5c + 0x04, 's32', 16, 0x7c })
add({ 'ofade', S + 0x5c + 0x4c, 's32', 16, 0x7c })
add({ 'cimg', S + 0x5c + 100 * 0x7c + 0x24, 's32', 8, 0x7c })
-- sound: bgm_request's bookkeeping (player, id, wanted per player)
add({ 'bgmcur', 0x800b5d80, 's32', 4 })
return fields
