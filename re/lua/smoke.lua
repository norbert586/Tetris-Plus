-- Smoke test and tracer for PCSX-Redux: boot the disc headless, press buttons on a schedule,
-- log whenever a different program is loaded into the shared slot at 0x80094000,
-- take periodic screenshots and dump main RAM at the end. Optionally logs every CD-ROM
-- command the running program issues (music seeks/plays and file reads).
--
-- Environment:
--   TP_OUT      output directory (must exist)
--   TP_FRAMES   frames to run (default 3600)
--   TP_SHOTS    screenshot interval in frames (default 120)
--   TP_TAP      periodic taps as BUTTON:first:last:every, comma separated for several
--               (default START:300:3000:90)
--   TP_INPUTS   extra presses as frame:BUTTON[+BUTTON]:hold, comma separated
--               (for example 3300:RIGHT:4,3400:CROSS:4)
--   TP_CD_HOOKS hook table from re/tools/cd_hooks.py (re/lua/cd_hooks.txt). When set, each
--               CdControl/CdControlF/CdControlB call is logged as
--               "frame N: cd PROGRAM FUNCTION com=0xCC param=b0 b1 b2 b3"
--   TP_WATCH    values to log whenever they change, as name=ADDRESS:BYTES (1, 2 or 4, little
--               endian), comma separated. A name starting with '!' also takes a screenshot on
--               change. Logged as "frame N: watch NAME OLD -> NEW" (decimal).

local outDir = os.getenv('TP_OUT') or '.'
local maxFrames = tonumber(os.getenv('TP_FRAMES') or '3600')
local shotEvery = tonumber(os.getenv('TP_SHOTS') or '120')

local pad = PCSX.SIO0.slots[1].pads[1]
local button = PCSX.CONSTS.PAD.BUTTON
local mem = PCSX.getMemPtr()

local frame = 0
local lastSlot = ''

local taps = {}
for entry in (os.getenv('TP_TAP') or 'START:300:3000:90'):gmatch('[^,]+') do
    local name, first, last, every = entry:match('^(%u+):(%d+):(%d+):(%d+)$')
    if not name then error('bad TP_TAP entry: ' .. entry) end
    table.insert(taps, { button = name, first = tonumber(first), last = tonumber(last), every = tonumber(every) })
end

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
    for _, tap in ipairs(taps) do
        if frame >= tap.first and frame <= tap.last and (frame - tap.first) % tap.every < 4 then
            pad.setOverride(button[tap.button])
        end
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

-- CD command tracing: fingerprint -> { name, CdControl, CdControlF, CdControlB }
local cdHooks, cdBreakpoints = {}, {}
local hooksPath = os.getenv('TP_CD_HOOKS')
if hooksPath then
    for line in io.lines(hooksPath) do
        local fp, name, a, b, c = line:match('^(%w+) (%S+) 0x(%x+) 0x(%x+) 0x(%x+)$')
        if fp then cdHooks[fp] = { name = name, CdControl = tonumber(a, 16), CdControlF = tonumber(b, 16),
                                   CdControlB = tonumber(c, 16) } end
    end
end

local function addCdBreakpoints(hooks, list)
    for _, fn in ipairs({ 'CdControl', 'CdControlF', 'CdControlB' }) do
        table.insert(list, PCSX.addBreakpoint(hooks[fn], 'Exec', 4, fn, function()
            local regs = PCSX.getRegisters().GPR.n
            local param = '-'
            if regs.a1 ~= 0 then
                local p = bit.band(regs.a1, 0x1fffff)
                param = string.format('%02x %02x %02x %02x', mem[p], mem[p + 1], mem[p + 2], mem[p + 3])
            end
            print(string.format('frame %d: cd %s %s com=0x%02x param=%s', frame, hooks.name, fn,
                                bit.band(regs.a0, 0xff), param))
            return true
        end))
    end
end

-- Global, like the listener below: Redux removes a breakpoint once its Lua handle is collected.
TpBootCdBreakpoints = {}
if cdHooks.boot then addCdBreakpoints(cdHooks.boot, TpBootCdBreakpoints) end

local function hookCdCommands(slot)
    for _, bp in ipairs(cdBreakpoints) do bp:remove() end
    cdBreakpoints = {}
    if cdHooks[slot] then addCdBreakpoints(cdHooks[slot], cdBreakpoints) end
end

local watches = {}
for entry in (os.getenv('TP_WATCH') or ''):gmatch('[^,]+') do
    local name, address, size = entry:match('^(!?[%w_]+)=0x(%x+):(%d)$')
    if not name then error('bad TP_WATCH entry: ' .. entry) end
    table.insert(watches, { name = name:gsub('^!', ''), shot = name:sub(1, 1) == '!',
                            address = bit.band(tonumber(address, 16), 0x1fffff), size = tonumber(size) })
end

local function readValue(address, size)
    local value = 0
    for i = size - 1, 0, -1 do value = value * 256 + mem[address + i] end
    return value
end

local function checkWatches()
    for _, w in ipairs(watches) do
        local value = readValue(w.address, w.size)
        if value ~= w.last then
            print(string.format('frame %d: watch %s %s -> %d', frame, w.name, tostring(w.last), value))
            if w.shot and w.last ~= nil then screenshot('watch ' .. w.name) end
            w.last = value
        end
    end
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
        if hooksPath then hookCdCommands(slot) end
        screenshot('slot change')
    elseif frame % shotEvery == 0 then
        screenshot('periodic')
    end

    checkWatches()

    if frame >= maxFrames then
        dumpRam()
        print(string.format('frame %d: done', frame))
        PCSX.quit(0)
    end
end)
