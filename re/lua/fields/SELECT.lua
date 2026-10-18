-- SELECT.EXE's trace fields (re/lua/movie.lua, route "power"): the shared ones, then its own.
local fields = dofile(os.getenv('TP_REPO') .. '/re/lua/fields/common.lua')
return fields
