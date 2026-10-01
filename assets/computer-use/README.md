# Autohand light-gray cursor

The theme uses `#D3D3D3` for the pointer and action animations, with the original white outline. A distinct theme ID prevents the driver's default session palette from recoloring the pointer.

The source is derived from Cua's MIT-licensed default Lottie theme. Attribution is in LICENSE-CUA.md and embedded in the generated module.

To regenerate with `cua-cursor-theme` 0.28.2:

```sh
cua-cursor-theme build assets/computer-use/autohand.light-gray.lottie --output assets/computer-use/autohand.light-gray.cua-theme
node scripts/embed-cursor-theme.mjs
```

The compiled asset and generated module are checked in so release builds require no native theme compiler. Both npm and standalone binaries carry the theme.
