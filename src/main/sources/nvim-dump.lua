-- Run by Keymaps as: nvim --headless -n -i NONE -c "luafile nvim-dump.lua"
-- Prints the user's keymaps (and which-key group names) as JSON between markers.

-- LazyVim and friends set most keymaps on VeryLazy, which never fires headless.
pcall(vim.api.nvim_exec_autocmds, "User", { pattern = "VeryLazy" })
vim.wait(200)

local modes = vim.split(vim.env.KEYMAPS_MODES or "n,x,i", ",", { trimempty = true })
local maps = {}
for _, mode in ipairs(modes) do
  for _, m in ipairs(vim.api.nvim_get_keymap(mode)) do
    table.insert(maps, { mode = mode, lhs = m.lhs, desc = m.desc, rhs = m.rhs })
  end
end

-- which-key group names, e.g. <leader>f = "file/find".
local groups = {}
local function walk(spec, mode)
  if type(spec) ~= "table" then return end
  mode = spec.mode or mode
  if type(spec[1]) == "string" and type(spec.group) == "string" then
    table.insert(groups, { lhs = spec[1], group = spec.group, mode = mode })
  end
  for _, child in ipairs(spec) do walk(child, mode) end
end
pcall(function()
  local plugin = require("lazy.core.config").plugins["which-key.nvim"]
  if plugin then walk(require("lazy.core.plugin").values(plugin, "opts", false).spec, "n") end
end)
pcall(function()
  for _, m in ipairs(require("which-key.config").mappings or {}) do
    if m.group and type(m.desc) == "string" then
      table.insert(groups, { lhs = m.lhs, group = m.desc, mode = m.mode or "n" })
    end
  end
end)

local result = {
  leader = vim.g.mapleader or "\\",
  localleader = vim.g.maplocalleader or vim.g.mapleader or "\\",
  maps = maps,
  groups = groups,
}
io.stdout:write("\n@@KEYMAPS@@" .. vim.json.encode(result) .. "@@END@@\n")
vim.cmd("qa!")
