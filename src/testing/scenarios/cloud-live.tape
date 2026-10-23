# Run only against an owned live session after deploying the native Cloud API.
# AUTOHAND_CLOUD_DEMO_ROOT is the CLI checkout; AUTOHAND_CLOUD_DEMO_SESSION is its session UUID.
# The normal CLI account config supplies authentication. Never put a token in this tape.
Require node
Output docs/gif/cloud-terminal.gif
Output docs/video/cloud-terminal.mp4
Set Shell "bash"
Set Width 1240
Set Height 820
Set FontSize 19
Set Padding 24
Set Margin 36
Set MarginFill "#c6d5e4"
Set BorderRadius 8
Set WindowBar Colorful
Set Theme "Catppuccin Mocha"
Set Framerate 20
Set PlaybackSpeed 1.5
Set TypingSpeed 35ms

Hide
Type 'cd "$AUTOHAND_CLOUD_DEMO_ROOT"'
Enter
Sleep 500ms
Type 'clear'
Enter
Show
Type 'node dist/index.js --cloud --plan --resume "$AUTOHAND_CLOUD_DEMO_SESSION"'
Enter
Wait+Screen@30s /Cloud session connected/
Sleep 1s
Screenshot docs/gif/cloud-terminal-attached.png
Type 'Read package.json and explain its test command in three short bullets under 60 words, without code blocks. Keep this read-only.'
Enter
Sleep 15s
Screenshot docs/gif/cloud-terminal-running.png
Type '/open web'
Enter
Sleep 3s
Ctrl+C
Sleep 2s
Type 'node dist/index.js --cloud --plan --resume "$AUTOHAND_CLOUD_DEMO_SESSION"'
Enter
Wait+Screen@30s /Cloud session connected/
Sleep 12s
Screenshot docs/gif/cloud-terminal-resumed.png
Ctrl+C
Sleep 2s
