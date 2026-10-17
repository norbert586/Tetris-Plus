-- Phase 4 scenario for re/lua/smoke.lua (TP_EXTRA): plays a chosen stage instead of Egypt 1.
-- While player 1 is on screen 3 (stage setup), pokes zone and stage from TP_STAGE (1-100), so
-- the stage intro loads that stage's layout and professor. Use with the usual route into
-- Egypt stage 1 (CLAUDE.md).

local SCREEN, ZONE, STAGE = 0x89b70, 0xeebb0, 0xeeb04
local n = tonumber(os.getenv('TP_STAGE') or '1') - 1
local poked = false

local function rd(mem, a)
    return mem[a] + mem[a + 1] * 256 + mem[a + 2] * 65536 + mem[a + 3] * 16777216
end

local function wr(mem, a, v)
    for i = 0, 3 do
        mem[a + i] = bit.band(bit.rshift(v, 8 * i), 0xff)
    end
end

return function(frame, mem, log)
    if rd(mem, SCREEN) == 3 then
        wr(mem, ZONE, math.floor(n / 20))
        wr(mem, STAGE, n % 20)
        if not poked then
            poked = true
            log(string.format('stage %d (zone %d, stage %d)', n + 1, math.floor(n / 20), n % 20))
        end
    end
end
