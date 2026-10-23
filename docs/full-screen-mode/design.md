# Full-screen terminal design

## Ownership

`InkRenderer` owns one alternate-screen lease for the interactive session. Modal renderers acquire nested leases instead of entering or leaving the terminal buffer independently. The last release restores the primary screen. Synchronous process-exit cleanup is a final safety net; listeners are removed during normal cleanup.

`AgentUI` retains the existing composer and input routing. A full-screen frame allocates the terminal height between a transcript viewport and the measured composer area. The inline render branch stays intact. The full-screen setting is captured at renderer startup, so `/experiments` never switches terminal ownership halfway through a turn.

## Transcript model

A focused presentation model formats canonical chat messages into width-aware terminal rows. Stable message objects reuse their formatted rows; updated streaming content replaces its own rows. Ink mounts only a viewport-sized slice. The row cache belongs to the transcript model and is released with the renderer. Resizing rebuilds width-dependent rows while preserving a message-relative reading anchor.

The model stores a tail-follow state or a message/row anchor. Appending output cannot move an anchored reader. Search operates on individual rendered lines (queries spanning a wrapped line are not matched) and exposes match positions; search input is separate from the composer draft. Ctrl+Home positions the viewport at its first row. Ctrl+End explicitly resumes tail following. New output sets a pending-activity marker while the viewport is anchored; following the tail clears it. A reserved single-line navigation area above the footer shows this state without moving the composer. Temporary expanded output is a presentation entry, never a new model message.

## Layout and interaction

The frame uses the existing theme, Markdown formatter and composer controls. Its header shows Autohand Code, the runtime version, and the working directory with the home directory abbreviated as `~`. A reserved row beneath the directory shows the existing loading indicator without moving the composer. Paging and search hints sit below the composer's status line. The composer area is height-bounded; excess ancillary content cannot grow the root beyond the terminal. Transcript rows fill remaining space. The measured footer origin is shared with the input so hardware cursor coordinates include its vertical offset. Shortcuts and suggestions grow above the composer; the status bar does not shrink when auxiliary content fills the viewport. The first experiment is validated down to 60 columns by 20 rows; smaller terminals may clip auxiliary controls.

Page keys and search are handled before composer editing only while the full-screen viewport is active. Escape dismisses search, then existing composer overlays, then history navigation before it can interrupt the active turn. Search supports forward and reverse wraparound. Existing agent inspector panels retain their input ownership. Native copy and OSC 8 links remain terminal-dependent; mouse capture follows the existing setting and terminal defaults. Wheel reports scroll the transcript, and measured absolute composer coordinates map clicks to the draft. Standalone modal screens clear their own frame and restore the parent frame on release without losing transcript or draft state.

## Compatibility and rollout

The local `full_screen_mode` registry flag is stable, true by default and restart-required. The setting is checked alongside TTY capability. There are no new dependencies or framework version changes. Full-screen mode can be disabled through the same registry and documented JSON/TOML/YAML config paths. Keep inline tests running alongside the full-screen scenarios.
