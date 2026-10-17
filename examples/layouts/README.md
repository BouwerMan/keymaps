# Custom layouts

Put a `.toml` file here to add a keyboard layout (or override a built-in by
using the same file name). Example, `my-board.toml`:

```toml
name = "My Board"
rows = [
  "Esc _0.25 F1 F2 F3 F4",          # _0.25 = horizontal gap
  "~0.25",                          # vertical gap
  "Grave 1 2 3 4 5 Backspace:2",    # :2 = 2u wide
  "Tab:1.5 Q W E R T",
  "KPPlus:1x2 A S D",               # :1x2 = 1u wide, 2u tall
  "Z X C Up@0.25",                  # @0.25 = nudged down 0.25u
]
```

A custom legend: `LSuper=Opt` draws "Opt" on the Super key.

Key ids: letters `A`-`Z`, digits `0`-`9`, `F1`-`F24`, `Esc Grave Minus Equal
Backspace Tab LBracket RBracket Backslash Caps Semicolon Quote Enter Comma
Period Slash Space LShift RShift LCtrl RCtrl LAlt RAlt LSuper RSuper Fn Menu
Left Right Up Down Ins Del Home End PgUp PgDn PrtSc ScrLk Pause Knob NumLock
KP0-KP9 KPSlash KPStar KPMinus KPPlus KPEnter KPDot`. Any other id is drawn
with its id as the label.
