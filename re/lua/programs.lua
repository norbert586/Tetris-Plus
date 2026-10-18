-- The mode programs other than PAZLE.EXE, for the tracer (re/lua/movie.lua's PROGRAMS: the
-- meaning of each key is there). Addresses from the decompiled programs (docs/re/flow.md):
-- main is the function `start` jumps to, padread the instruction after the main loop's
-- `jal PadRead`, ot the GsClearOt arguments in the main loop, cd the matched libcd functions.
return {
    {
        name = 'SW_ON', fingerprint = 'fc530980fc530980fc530980fc530980',
        main = 0x800957b0, padread = 0x800959a0, rand = 0x8009a8f0,
        ot = { 0x800b6624, 0x800b5c64 }, cd = { 0x8009fa14, 0x8009fb4c, 0x8009fc78 },
        fields = 're/lua/fields/SW_ON.lua',
    },
    {
        name = 'TIT_DEMO', fingerprint = 'e46b09800c6c0980546c0980806c0980',
        main = 0x80095718, padread = 0x80094bbc, rand = 0x80098370,
        ot = { 0x800b5e78, 0x800b5e8c }, cd = { 0x8009d4b4, 0x8009d5ec, 0x8009d718 },
        se = 0x80094cc8, bgm = 0x800951fc, cdReport = 0x800950d4, -- se_play, bgm_request, CD callback
        fields = 're/lua/fields/TIT_DEMO.lua',
    },
    {
        name = 'TITLE', fingerprint = 'a871098044720980c072098078730980',
        main = 0x80095704, padread = 0x800958d0, rand = 0x80099668,
        ot = { 0x800b4314, 0x800b4350 }, cd = { 0x8009e7ac, 0x8009e8e4, 0x8009ea10 },
        -- se_play, bgm_request, CD callback, the item decompressor (logs the packed item's address)
        se = 0x80094d30, bgm = 0x800950e8, cdReport = 0x80094fc0, itemLoad = 0x80096314,
        fields = 're/lua/fields/TITLE.lua',
    },
    {
        name = 'SELECT', fingerprint = '4c5409804c5409804c5409804c540980',
        main = 0x80095800, padread = 0x800959f0, rand = 0x8009d7fc,
        ot = { 0x800b9a70, 0x800b905c }, cd = { 0x800a2920, 0x800a2a58, 0x800a2b84 },
        -- se_play, bgm_request, the item decompressor (logs the packed item's address; every
        -- upload goes through it) and the CD report callback (docs/re/select.md)
        se = 0x80094d2c, bgm = 0x80095140, itemLoad = 0x80096620, cdReport = 0x80094ff4,
        fields = 're/lua/fields/SELECT.lua',
    },
    {
        name = 'RANKING', fingerprint = 'a8680980c8680980f4680980fc680980',
        main = 0x800956c0, padread = 0x80094b64, rand = 0x80097ab4,
        ot = { 0x800b25c8, 0x800b25d8 }, cd = { 0x8009cbf8, 0x8009cd30, 0x8009ce5c },
        fields = 're/lua/fields/RANKING.lua',
    },
    -- The attract demos (Classic, Puzzle and VS how-to-play; not ported, traced so a power-on
    -- run follows the attract loop: docs/re/title.md §4). Shared fields only.
    {
        name = 'HOW_N', fingerprint = '087909803079098080790980d0790980',
        main = 0x80095b20, padread = 0x80094fc4, rand = 0x800a23ac,
        ot = { 0x800cb500, 0x800cb538 }, cd = { 0x800a766c, 0x800a77a4, 0x800a78d0 },
        fields = 're/lua/fields/common.lua',
    },
    {
        name = 'HOW_P', fingerprint = 'a87b0980d07b0980247c0980787c0980',
        main = 0x80095b8c, padread = 0x80094f6c, rand = 0x800a5990,
        ot = { 0x800d3f98, 0x800d4024 }, cd = { 0x800aaad4, 0x800aac0c, 0x800aad38 },
        fields = 're/lua/fields/common.lua',
    },
    {
        name = 'HOW_VS', fingerprint = 'b4750980f87509807c760980f8760980',
        main = 0x80095bdc, padread = 0x80094fbc, rand = 0x800a5d00,
        ot = { 0x800cf1bc, 0x800cf2ec }, cd = { 0x800aaf1c, 0x800ab054, 0x800ab180 },
        fields = 're/lua/fields/common.lua',
    },
}
