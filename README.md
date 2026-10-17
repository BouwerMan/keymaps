# Keymaps

A small desktop app that draws your keyboard and shows you what your keybinds do,
for as many apps as you like (Hyprland, Neovim, tmux, …). Binds live in TOML files.

## Run

```sh
npm install
npm start                     # or: bin/keymaps
bin/keymaps --app neovim      # open on a specific app
bin/keymaps --toggle          # hide if already open and focused (good for a WM bind)
```

To add it to your app launcher (with right-click actions for each app):

```sh
bin/install-desktop              # writes ~/.local/share/applications/keymaps.desktop
bin/install-desktop --uninstall
```

Only one window runs at a time: launching again focuses it (and switches app if
`--app` is given). Hyprland example:

```
bind = $mainMod, F1, exec, ~/code/keymaps/bin/keymaps --toggle
```

## Using it

- **Click a key** to get a popover with what it does, plus other binds that use it.
  Click the key again (or press it, or Esc) to close it.
- **Click or hold a modifier** (Super, Ctrl, …) and the keyboard relabels with every
  combo using it. Modifier keys show how many combos they unlock. If you're holding
  modifiers when you open a dialog, they stay on after you let go, until the dialog
  closes or you press Esc. Modifiers you clicked stay on until Esc.
- **Sequences** (`<leader>ff`, `<C-w>v`, `gg`) step through: press the first key and
  the keyboard shows what can come next. Dashed keys continue a sequence.
- **Your real keyboard works** while the window is focused. Esc resets.
- **Hover a bind** in the side list to trace its keys on the board (numbers show step
  order); click to pin it.
- Search and mode filters (`n`, `i`, `v`, …) narrow both the list and the board.

## Config

On first run, `~/.config/keymaps/` (or `$XDG_CONFIG_HOME/keymaps`) is created from
`examples/`. The app reloads whenever you save a file there.

```
~/.config/keymaps/
  config.toml        default layout / app
  apps/*.toml        one file per app
  layouts/*.toml     optional custom keyboards (see examples/layouts/README.md)
```

### Live sources

An app can read binds straight from the program's own config, re-reading whenever it
changes:

```toml
[source]
type = "neovim"            # runs `nvim --headless` and asks for its keymaps
modes = ["n", "x", "i"]    # optional
exclude = ["<leader>u"]    # optional: hide maps starting with these keys
```

```toml
[source]
type = "hyprland"
path = ["~/.config/hypr/hyprland.lua", "~/dotfiles/hypr/hyprland.lua"]  # optional; first that exists
```

```toml
[source]
type = "tmux"
config = "~/.config/tmux/tmux.conf"   # optional
copy_mode = true                      # optional: include vi copy-mode keys (mode "copy")
```

- **Neovim** picks up everything that's mapped globally, plugin maps included
  (LazyVim etc.), and groups them by which-key group names. Maps with no
  description are hidden, and the app tells you which. LSP maps only exist once a
  server attaches, so describe those by hand (the example file does).
- **Hyprland** reads both config formats. A `hyprland.lua` config is run with
  `lua` against a stand-in `hl` API that only records `hl.bind()` calls (shell
  commands are disabled), so loops and `require`d files work. Descriptions come
  from `description`, and groups come from `-- Section -----` comments. A
  `hyprland.conf` is parsed as text: `$variables`, `source =` includes, `bindd`,
  trailing `# comments`, or a summary like "Go to workspace 3". Submaps become
  sequences (`Super+R` then `h`). If no config exists yet, the app waits for one.
- **tmux** starts a private, throwaway tmux server (`tmux -L keymaps-probe-…`) with
  your config, plugins included, and reads its key tables. Your sessions aren't
  touched. Default keys use tmux's own descriptions, and hand-written binds can
  say `prefix x`.

Binds written in the same `.toml` are merged in: if the keys match an imported bind,
your description replaces its own; otherwise the bind is added. Use that to name
undescribed maps, or to add vim built-ins (`gg`, `dd`) that aren't mappings.

### An app file

```toml
name = "tmux"
color = "#1bb91f"   # optional accent
order = 3           # optional tab order

[aliases]
prefix = "Ctrl+b"   # any token, used as a whole word below

[groups.Panes]
"prefix %" = "Split vertical"
'prefix "' = "Split horizontal"
"prefix x" = { desc = "Kill pane", note = "Asks for confirmation" }

# Long form, when you want modes, notes, or several keys for one action:
[[bind]]
keys = ["prefix Left", "prefix h"]
desc = "Pane left"
group = "Panes"
mode = "normal"     # any string(s); the app adds filter chips for them
```

### Key syntax

| Write                      | Means                                        |
| -------------------------- | -------------------------------------------- |
| `Super+Shift+Q`            | chord (`Super`/`Mod`/`Win`, `Ctrl`, `Alt`, `Shift`) |
| `Ctrl+b c`                 | sequence: steps separated by spaces          |
| `<leader>ff`, `<C-w>v`     | vim notation (`C- S- A- M- D-` modifiers)     |
| `gg`, `G`, `?`, `$`        | characters; uppercase and symbols imply Shift |
| `Enter`, `Esc`, `F5`, `PgUp`, `Left`, `Space`, `Tab`, `Del` | named keys |
| `XF86AudioRaiseVolume`     | drawn on the Q1's knob                       |

Anything unrecognized (e.g. `mouse:272`) is still listed, just not drawn on the
keyboard. `leader` defaults to `\` like in vim; set it under `[aliases]`.

## Layouts

Built in: Keychron Q1 Max (75% ANSI; the Super key is labelled Opt), ANSI 60%,
ANSI TKL, ANSI full size. Add your own in `layouts/` with a short row syntax (see
`examples/layouts/README.md`). `LSuper=Opt` in a row relabels a keycap without
changing what it does.

## Development

```sh
npm test    # parser, layout and config tests
```

Code: `src/main/` (Electron main process: config loading, key parsing, layouts,
`sources/` for the Neovim and Hyprland importers),
`src/renderer/` (the UI, plain HTML/CSS/JS, no build step).
