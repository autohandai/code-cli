---
name: performance-analysis
description: Measure before optimizing. Profile startup time, latency, throughput, memory, or bundle size, find the dominant cost with evidence, and propose the smallest change that moves the number. Use for "slow", "takes N seconds", "high CPU or memory", and performance regressions.
allowed-tools: read_file find_grep fff_find list_tree run_command git_log git_diff file_stats
---

# Analyze performance with numbers

Optimizing without a measurement changes the code without changing the
outcome. Every step below produces a number you can show.

## Establish the baseline

1. Define the metric and the scenario exactly: what is slow, from which event
   to which, on what input size, on what machine. Ask if unclear.
2. Measure it three times with the tools the project already has (timers,
   `--profile` flags, `time`, `hyperfine`, language profilers, `--cpu-prof`,
   heap snapshots, bundle analyzers). Record median and spread.
3. Record the environment: load average, CPU count, disk free, network,
   concurrent processes. A loaded machine invalidates comparisons.

## Find the dominant cost

- Break the total into phases with timestamps or a profiler; sort by time.
- Distinguish blocking waits (network, disk, subprocess, locks, timeouts) from
  CPU work; the fix differs.
- Look for the usual shapes: sequential awaits that could be parallel, work
  repeated per item that could be cached, unbounded scans that need a budget,
  startup work that could be lazy or deferred, N+1 calls, large payloads,
  synchronous I/O on the main thread, retries with long timeouts.
- Check what scales with input size using two sizes and compare.

## Change one thing, then measure again

- Pick the change with the best ratio of expected gain to risk. State the
  expected gain before making it.
- Re-measure the same way. Report before and after with the spread.
- Add a guard so it stays fixed: a timing assertion with a generous bound, a
  budget constant, or a test that the work is deferred or cached.

## Report

Metric, scenario, baseline, cause with file:line, change, result, and what was
not addressed. If the measurement showed the suspected cause was wrong, say so.
