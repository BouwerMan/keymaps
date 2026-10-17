-- Run by Keymaps as: lua hypr-lua-dump.lua /path/to/hyprland.lua
--
-- Runs a Hyprland Lua config against a stand-in `hl` API that records every
-- hl.bind() call instead of doing anything. Prints them as JSON between markers.

local main = assert(arg[1], "usage: hypr-lua-dump.lua <hyprland.lua>")
local dir = main:match("^(.*)/[^/]*$") or "."
package.path = dir .. "/?.lua;" .. dir .. "/?/init.lua;" .. package.path

-- Only reading the config: neutralise anything that could act on the system.
os.execute = function() return true end
os.exit = function() end
os.remove = function() return true end
os.rename = function() return true end
io.popen = function()
  return { read = function() return "" end, lines = function() return function() end end, close = function() return true end }
end

local binds, errors, current_submap = {}, {}, nil

-- A table that accepts any field access or call, remembering the path:
-- hl.dsp.window.close() -> { action = "dsp.window.close", args = {} }
local function proxy(path)
  return setmetatable({}, {
    __index = function(_, k) return proxy(path == "" and tostring(k) or (path .. "." .. tostring(k))) end,
    __call = function(_, ...) return { action = path, args = { ... } } end,
  })
end

-- First stack frame that is inside the user's config (not this script).
local function caller()
  for level = 3, 12 do
    local info = debug.getinfo(level, "Sl")
    if not info then break end
    if info.source:sub(1, 1) == "@" and not info.source:find("hypr%-lua%-dump%.lua$") then
      return info.source:sub(2), info.currentline
    end
  end
end

hl = proxy("")
rawset(hl, "bind", function(keys, action, opts)
  local file, line = caller()
  local entry = { keys = keys, submap = current_submap, file = file, line = line, opts = {} }
  if type(action) == "table" and action.action then
    entry.action, entry.args = action.action, action.args
  elseif type(action) == "function" then
    entry.action = "lua function"
  end
  if type(opts) == "table" then
    for k, v in pairs(opts) do
      if type(v) ~= "function" and type(v) ~= "table" then entry.opts[k] = v end
    end
  end
  table.insert(binds, entry)
  return proxy("bind")
end)
rawset(hl, "define_submap", function(name, fn)
  local previous = current_submap
  current_submap = name
  if type(fn) == "function" then
    local ok, err = pcall(fn)
    if not ok then table.insert(errors, tostring(err)) end
  end
  current_submap = previous
  return proxy("submap")
end)

-- Hyprland runs each require() in its own scope, so one broken file doesn't stop the rest.
local real_require = require
require = function(name)
  local ok, result = pcall(real_require, name)
  if ok then return result end
  table.insert(errors, tostring(result))
  return proxy(name)
end

local ok, err = pcall(dofile, main)
if not ok then table.insert(errors, tostring(err)) end

-- Minimal JSON encoder (strings, numbers, booleans, nested tables).
local function encode(v)
  local t = type(v)
  if t == "string" then
    return '"' .. v:gsub('[%c"\\]', function(c)
      local map = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\t"] = "\\t", ["\r"] = "\\r" }
      return map[c] or string.format("\\u%04x", c:byte())
    end) .. '"'
  elseif t == "number" or t == "boolean" then
    return tostring(v)
  elseif t == "table" then
    if getmetatable(v) then return "null" end -- a proxy
    local n = #v
    if n > 0 or next(v) == nil then
      local parts = {}
      for i = 1, n do parts[i] = encode(v[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local parts = {}
    for k, val in pairs(v) do table.insert(parts, encode(tostring(k)) .. ":" .. encode(val)) end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end

io.stdout:write("\n@@KEYMAPS@@" .. encode({ binds = binds, errors = errors }) .. "@@END@@\n")
