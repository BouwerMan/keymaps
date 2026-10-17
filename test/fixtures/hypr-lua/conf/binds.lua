local function bind(keys, action, description, flags)
    local f = { description = description }
    for k, v in pairs(flags or {}) do f[k] = v end
    return hl.bind(keys, action, f)
end

-- Apps -------------------------------------------------------------------------
bind("SUPER + Return", hl.dsp.exec_cmd("kitty"), "Terminal")
hl.bind("SUPER + B", hl.dsp.exec_cmd("firefox"))

-- Windows ----------------------------------------------------------------------
for key, dir in pairs({ h = "left", l = "right" }) do
    bind("SUPER + SHIFT + " .. key, hl.dsp.window.move({ direction = dir }), "Move window " .. dir)
end
hl.define_submap("resize", function()
    bind("h", hl.dsp.window.resize({ x = -40 }), "Resize", { repeating = true })
end)

-- Media keys (work on the lock screen too) -------------------------------------
bind("XF86AudioRaiseVolume", hl.dsp.exec_cmd("wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%+"), "Volume up", { locked = true })
