-- Fields the movie tracer (re/lua/movie.lua) records every logic tick, player 1 unless named
-- otherwise. Addresses and meanings are in re/symbols/PAZLE.vars.tsv and docs/re/ram-map.md.
-- Each entry: { name, address, type [, count [, stride]] }. Types: s32, u32, s16, u16, u8.
-- With a count the field is an array (stride defaults to the type's size).
-- Values are raw: 16.16 positions stay 16.16 (re/tools/tptrace.py shows them in pixels).
-- The board, the per-tick sound/music calls and rand() counts are added by movie.lua itself.
-- Changing this list changes the trace format: bump TRACE_VERSION in movie.lua.

local S = 0x8003e668 -- the boot program's shared state block

return {
    -- frame and flow
    { 'ctr', S + 0x40, 'u32' },               -- global frame counter (+1 per tick)
    { 'seed', 0x800083a4, 'u32' },            -- BIOS rand() seed (OpenBIOS's location)
    { 'pad', 0x800f36f2, 'u16' },             -- P1 held, as the logic of this tick saw it
    { 'padp', 0x800f36f4, 'u16' },            -- P1 newly pressed
    { 'pad2', 0x800f36f8, 'u16' },
    { 'padp2', 0x800f36fa, 'u16' },
    { 'phase', S + 0x50, 'u32' },             -- phase_dispatch's state
    { 'scr', S + 0x4b508, 'u32', 2 },         -- screen per player
    { 'step', S + 0x4b510, 'u32', 2 },        -- step within the screen per player
    -- stage
    { 'zone', 0x800eebb0, 's32' },
    { 'stage', 0x800eeb04, 's32' },
    { 'zones_cleared', 0x800f35c8, 's32' },
    { 'hundred', 0x800ee38c, 's32' },
    { 'score', 0x800ee3b4, 's32' },
    { 'stage_flags', 0x800ee3a4, 's32' },
    { 'lose_flags', 0x800ee348, 's32' },
    { 'clear_flags', 0x800ee5bc, 's32' },
    { 'clear_countdown', 0x800edc80, 's32' },
    { 'stage_time', 0x800ee580, 's32' },
    { 'stage_time_sub', 0x800ee6c0, 's32' },
    { 'intro_countdown', 0x800eeae4, 's32' },
    { 'retire', 0x800ee3f8, 's32' },
    { 'best_times', S + 0x4ad84, 'u16', 100 },
    { 'difficulty', S + 0x4b4fe, 'u8' },
    -- falling piece and queue
    { 'piece', 0x800ee384, 's32' },
    { 'px', 0x800ee3c8, 's32' },
    { 'py', 0x800ee3d8, 's32' },
    { 'rot', 0x800f35dc, 's32' },
    { 'next1', 0x800ee4c4, 's32' },
    { 'next2', 0x800ee4dc, 's32' },
    { 'input_dx', 0x800ee374, 's32' },
    { 'input_rot', 0x800edc98, 's32' },
    { 'gravity_dy', 0x800ee37c, 's32' },
    { 'das_delay', 0x800ee478, 's32' },
    { 'das_repeat', 0x800ee418, 's32' },
    { 'gravity_count', 0x800f2cec, 's32' },
    { 'has_dropped', 0x800ee3f0, 's32' },
    { 'lock_count', 0x800f3644, 's32' },
    { 'spawn_delay', 0x800f364c, 's32' },
    { 'pieces', 0x800f2ad0, 's32' },
    -- lines
    { 'lock_top_row', 0x800ee97c, 's32' },
    { 'full_rows', 0x800eeaa4, 's32', 5 },
    { 'lines_found', 0x800eea40, 's32' },
    { 'clear_anim_state', 0x800ee3d0, 's32' },
    { 'clear_anim_frame', 0x800ee91c, 's32' },
    { 'lines_this_clear', 0x800f35e4, 's32' },
    { 'lines_cleared', 0x800ee924, 's32' },
    { 'lines_for_prof', 0x800f35d0, 's32' },
    { 'popup_state', 0x800ee6c8, 's32' },
    -- ceiling
    { 'ceil_y', 0x800ee914, 's32' },
    { 'ceil_timer', 0x800ee3e0, 's32' },
    { 'ceil_drops', 0x800ee39c, 's32' },
    { 'ceil_pushback', 0x800ee7b0, 's32' },
    { 'ceil_shake', 0x800ee358, 's32' },
    { 'ceil_state', 0x800f2d00, 's32' },
    -- professor
    { 'prof_state', 0x800ee6d8, 's32' },
    { 'prof_sub', 0x800f0be0, 's32' },
    { 'prof_col', 0x800ee85c, 's32' },
    { 'prof_row', 0x800ee864, 's32' },
    { 'prof_facing', 0x800ee854, 's32' },
    { 'prof_action', 0x800ee844, 's32' },
    { 'prof_prev_action', 0x800ee8d0, 's32' },
    { 'prof_channel', 0x800ee7e4, 's32' },
    { 'prof_ch_action', 0x800ee8ac, 's32', 4 },
    { 'prof_ch_script', 0x800ee88c, 'u32', 4 },
    { 'prof_wait', 0x800ee7dc, 's32' },
    { 'prof_done', 0x800ee83c, 's32' },
    { 'prof_sensors', 0x800ee7ec, 's32', 10 },
    { 'prof_turns', 0x800ee7cc, 's32' },
    { 'prof_lifted', 0x800ee7bc, 's32' },
    { 'prof_fall', 0x800ee7c4, 's32' },
    { 'prof_headroom', 0x800ee87c, 's32' },
    { 'prof_danger', 0x800ee884, 's32' },
    { 'prof_hold', 0x800ee490, 's32' },
    { 'prof_fast', 0x800ee570, 's32' },
    { 'prof_sx', S + 0x5c + 40 * 0x7c + 0x00, 's32' }, -- sprite object 40: 0x8003FA24
    { 'prof_sy', S + 0x5c + 40 * 0x7c + 0x04, 's32' },
    -- password entry
    { 'pw_symbols', 0x800ee58c, 's32', 6 },
    { 'pw_cursor', 0x800f0bbc, 's32' },
    -- memory card (trace version 4, docs/re/shell.md)
    { 'sub', S + 0x4b518, 'u32', 2 },         -- substep within the step per player
    { 'card_port', 0x800f2d1c, 's32', 2 },    -- port chosen per player (save screen: option)
    { 'slot_cursor', 0x800ed320, 's32', 2 },
    { 'card_flags', 0x800f2ac8, 's32' },      -- 1 card in use, 0x10 new file
    { 'card_result', 0x800eeae0, 's32' },     -- last card check / load / format result
    { 'card_io', 0x800ee3bc, 's32' },         -- bytes the last read or write moved
    { 'saved_stage', 0x800f2ad8, 's32' },
    { 'slots', S + 0x4aed8, 'u8', 6 },        -- the three save slots: stage, zones cleared
    { 'card_sum', 0x800eedbc, 'u8', 2 },      -- the file buffer's first XOR and first byte of copy 1
}
