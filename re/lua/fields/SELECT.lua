-- SELECT.EXE's trace fields (re/lua/movie.lua, route "power"): the shared ones, then its own.
-- Addresses and meanings: docs/re/select.md.
local S = 0x8003e668
local fields = dofile(os.getenv('TP_REPO') .. '/re/lua/fields/common.lua')
local function add(f) fields[#fields + 1] = f end
local function obj(field) return S + 0x5c + field end

-- pads: held / newly pressed, pad 1 and pad 2
add({ 'pad', 0x800be126, 'u16' })
add({ 'padp', 0x800be128, 'u16' })
add({ 'pad2', 0x800be12c, 'u16' })
add({ 'padp2', 0x800be12e, 'u16' })
-- mode select (param 0)
add({ 'mstep', 0x800b9094, 's32' })        -- its step
add({ 'msel', 0x800b90a0, 's32' })         -- the tile: 0 classic, 1 puzzle, 2 VS, 3 edit, 4 option
add({ 'mwait', 0x800b90a4, 's32' })        -- the countdown before leaving
-- option mode (param 1, phase and subphase)
add({ 'orow', 0x800b9a4c, 's32' })         -- cursor row 0-12
add({ 'orot', 0x800be114, 's32', 4 })      -- rotation button indices: P1 left, P1 right, P2 left, P2 right
add({ 'orotv', 0x800be024, 's32', 2 })
add({ 'orotr', 0x800b9ac0, 's32', 2 })
add({ 'ohi', 0x800be048, 's32' })          -- the highlight image offset (0 or 0x38)
add({ 'olevel', 0x800b9a3c, 's32' })
add({ 'omatch', 0x800b9a2c, 's32' })
add({ 'otmp', 0x800b9a38, 's32' })
add({ 'obgm', 0x800b9adc, 's32' })         -- sound test: music number
add({ 'ose', 0x800b9a34, 's32' })          -- sound test: effect number
add({ 'ovol', 0x800b9bac, 's32' })
add({ 'odata', 0x800b9c48, 's32' })        -- option data: 0 load, 1 save
add({ 'orank', 0x800b9c84, 's32' })        -- ranking data: 0 load, 1 save
add({ 'oyes', 0x800b9c90, 's32' })         -- card prompts: the choice
add({ 'ocard', 0x800b9cec, 's32' })        -- card prompts: the last card call's result
add({ 'ofree', 0x800b9ce8, 's32' })
add({ 'oread', 0x800b9a48, 's32' })
add({ 'ocardst', 0x800b9050, 's32' })
add({ 'oslot', 0x800bbd70, 's32' })
add({ 'otimer', S + 0x1fd0c, 's32' })
-- settings (S+0x4B4EC, 24 bytes) and the flags around them
add({ 'settings', S + 0x4b4ec, 'u8', 24 })
add({ 'rankdata', S + 0x4ae60, 'u32', 30 }) -- what the ranking data load/save moves
add({ 'rows', S + 0x4b538, 's32' })
add({ 'twop', S + 0x4b53c, 's32' })
-- sound: bgm_request's bookkeeping and the CD player state
add({ 'bgmcur', 0x800b90c0, 's32', 4 })
add({ 'cdtrack', 0x800b90f4, 's32' })
add({ 'cdmode', 0x800b90f8, 's32' })
add({ 'cdend', 0x800b9128, 's32' })
add({ 'cdstart', 0x800b9124, 's32' })
-- sprite objects 0-127: image, position, scale, blend, flip, priority
add({ 'oimg', obj(0x24), 's32', 128, 0x7c })
add({ 'ox', obj(0x00), 's32', 128, 0x7c })
add({ 'oy', obj(0x04), 's32', 128, 0x7c })
add({ 'osx', obj(0x08), 's32', 128, 0x7c })
add({ 'osy', obj(0x0c), 's32', 128, 0x7c })
add({ 'oblend', obj(0x14), 's32', 128, 0x7c })
add({ 'oflip', obj(0x44), 's32', 128, 0x7c })
add({ 'opri', obj(0x40), 's32', 128, 0x7c })
add({ 'oanim', obj(0x2c), 's32', 128, 0x7c })
add({ 'oatime', obj(0x30), 's32', 128, 0x7c })
add({ 'oaframe', obj(0x34), 's32', 128, 0x7c })
add({ 'ox2', obj(0x4c), 's32', 128, 0x7c }) -- saved positions (zoomed tile)
add({ 'oy2', obj(0x50), 's32', 128, 0x7c })
return fields
