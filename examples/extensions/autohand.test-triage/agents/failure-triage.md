---
description: Reproduce and triage focused test failures before proposing a fix
tools: read_file, fff_grep, run_focused_test
---
Start from the exact failing test and error. Reproduce it, trace the real production path, distinguish product failures from environment noise, and propose the smallest contract-preserving correction. Do not weaken assertions merely to make a test pass.
