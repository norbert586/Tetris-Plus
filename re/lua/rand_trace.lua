-- TP_EXTRA script for re/lua/smoke.lua: logs every rand() call PAZLE.EXE makes from frame
-- TP_RAND_FROM on (default 7600), as "frame N: rand ra=0x... seed=0x..." (seed before the call;
-- OpenBIOS keeps it at 0x800083a4). rand is PAZLE.EXE's BIOS stub at 0x800c0c48.

local from = tonumber(os.getenv('TP_RAND_FROM') or '7600')
local current = 0

TpRandBreakpoint = nil

return function(frame, mem)
    current = frame
    if TpRandBreakpoint or frame < from then return end
    TpRandBreakpoint = PCSX.addBreakpoint(0x800c0c48, 'Exec', 4, 'rand', function()
        local regs = PCSX.getRegisters().GPR.n
        local seed = mem[0x83a4] + mem[0x83a5] * 256 + mem[0x83a6] * 65536 + mem[0x83a7] * 16777216
        print(string.format('frame %d: rand ra=0x%08x seed=0x%08x', current, regs.ra, seed))
        return true
    end)
end
