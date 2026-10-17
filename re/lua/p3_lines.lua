-- Phase 3 scenario for re/lua/smoke.lua (TP_EXTRA): forces line clears on Egypt stage 1 so the
-- scoring, line-count, ceiling-pushback and stage-clear variables get written. Pokes the board
-- (logic only: the block sprites are not updated, so the screen shows stale blocks).
--   A: at the first I piece spawned after frame 10200 (the ceiling has dropped twice by then),
--      empty the board, restore the stage layout, fill rows 9-12 except column 5, put a
--      column of blocks under column 5 and turn the I vertical: it lands in column 5 -> 4 lines.
--   B: at the first I piece 200 frames after A, empty the board again, restore the stage
--      layout and fill row 15 except column 5: the vertical I lands at rows 12-15 -> 1 line
--      under the professor, who then drops to row 15 (the goal row).

local BOARD, PIECE, ROT, STEP = 0xedca0, 0xee384, 0xf35dc, 0x89b78
local stage = 0
local doneAt = 0

local function rd(mem, a)
    return mem[a] + mem[a + 1] * 256 + mem[a + 2] * 65536 + mem[a + 3] * 16777216
end

local function wr(mem, a, v)
    for i = 0, 3 do
        mem[a + i] = bit.band(bit.rshift(v, 8 * i), 0xff)
    end
end

local function cell(mem, row, col, v)
    wr(mem, BOARD + (row * 10 + col) * 4, v)
end

local function resetBoard(mem)
    for row = 1, 15 do
        for col = 0, 9 do cell(mem, row, col, 0) end
    end
    cell(mem, 14, 2, 5)
    for col = 0, 2 do cell(mem, 15, col, 5) end
end

local function spawnedI(mem)
    -- step 1 (falling) and still in the spawn row: y = -20 px
    return rd(mem, PIECE) == 1 and rd(mem, STEP) == 1 and rd(mem, 0xee3d8) == 0xffec0000
end

return function(frame, mem, log)
    if stage == 0 and frame >= 10200 and spawnedI(mem) then
        resetBoard(mem)
        for row = 9, 12 do
            for col = 0, 9 do
                if col ~= 5 then cell(mem, row, col, 3) end
            end
        end
        for row = 13, 15 do cell(mem, row, 5, 3) end
        wr(mem, ROT, 1)
        stage, doneAt = 1, frame
        log('A: 4-line setup')
    elseif stage == 1 and frame >= doneAt + 200 and spawnedI(mem) then
        resetBoard(mem)
        for col = 3, 9 do
            if col ~= 5 then cell(mem, 15, col, 3) end
        end
        wr(mem, ROT, 1)
        stage = 2
        log('B: 1-line setup under the professor')
    end
end
