-- Phase 0 smoke test for PCSX-Redux: boot the disc headless, press buttons on a schedule,
-- log whenever a different program is loaded into the shared slot at 0x80094000,
-- take periodic screenshots and dump main RAM at the end.
--
-- Environment:
--   TP_OUT     output directory (must exist)
--   TP_FRAMES  frames to run (default 3600)
--   TP_SHOTS   screenshot interval in frames (default 120)
--   TP_TAP     periodic taps as BUTTON:first:last:every (default START:300:3000:90)
--   TP_INPUTS  extra presses as frame:BUTTON[+BUTTON]:hold, comma separated
--              (for example 3300:RIGHT:4,3400:CROSS:4)

local outDir = os.getenv('TP_OUT') or '.'
local maxFrames = tonumber(os.getenv('TP_FRAMES') or '3600')
local shotEvery = tonumber(os.getenv('TP_SHOTS') or '120')

local pad = PCSX.SIO0.slots[1].pads[1]
local button = PCSX.CONSTS.PAD.BUTTON
local mem = PCSX.getMemPtr()

local frame = 0
local lastSlot = ''

local tapButton, tapFirst, tapLast, tapEvery = (os.getenv('TP_TAP') or 'START:300:3000:90'):match(
    '^(%u+):(%d+):(%d+):(%d+)$')
tapFirst, tapLast, tapEvery = tonumber(tapFirst), tonumber(tapLast), tonumber(tapEvery)

-- held[frame] = list of buttons to hold on that frame
local held = {}
for entry in (os.getenv('TP_INPUTS') or ''):gmatch('[^,]+') do
    local at, names, hold = entry:match('^(%d+):([%u%d+]+):(%d+)$')
    if not at then error('bad TP_INPUTS entry: ' .. entry) end
    for f = tonumber(at), tonumber(at) + tonumber(hold) - 1 do
        held[f] = held[f] or {}
        for name in names:gmatch('[^+]+') do table.insert(held[f], name) end
    end
end

local function applyInputs()
    for _, value in pairs(button) do pad.clearOverride(value) end
    if tapButton and frame >= tapFirst and frame <= tapLast and (frame - tapFirst) % tapEvery < 4 then
        pad.setOverride(button[tapButton])
    end
    for _, name in ipairs(held[frame] or {}) do pad.setOverride(button[name]) end
end

local function slotFingerprint()
    local bytes = {}
    for i = 0, 15 do bytes[#bytes + 1] = string.format('%02x', mem[0x94000 + i]) end
    return table.concat(bytes)
end

local function screenshot(tag)
    local shot = PCSX.GPU.takeScreenShot()
    local name = string.format('%s/shot_%05d_%dx%d_%s.raw', outDir, frame, shot.width, shot.height,
                               shot.bpp == 0 and '16' or '24')
    local file = Support.File.open(name, 'TRUNCATE')
    file:writeMoveSlice(shot.data)
    file:close()
    print(string.format('frame %d: screenshot %s (%s)', frame, name, tag))
end

local function dumpRam()
    local file = Support.File.open(outDir .. '/ram_end.bin', 'TRUNCATE')
    file:write(mem, 0x200000)
    file:close()
end

TpSmokeListener = PCSX.Events.createEventListener('GPU::Vsync', function()
    frame = frame + 1
    applyInputs()

    local slot = slotFingerprint()
    if slot ~= lastSlot then
        lastSlot = slot
        print(string.format('frame %d: program slot now starts %s', frame, slot))
        screenshot('slot change')
    elseif frame % shotEvery == 0 then
        screenshot('periodic')
    end

    if frame >= maxFrames then
        dumpRam()
        print(string.format('frame %d: done', frame))
        PCSX.quit(0)
    end
end)
