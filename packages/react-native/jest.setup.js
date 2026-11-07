// Freeze the wall clock for every spec in this package. Stroke lifetimes
// (hold 2 s, fade 0.5 s) and the per-sender rate limit run off Date.now(),
// so on a slow CI machine a stroke could genuinely fade, or the bucket
// refill, between a test's draw and its assertion. No spec here tests the
// passage of time (protocol/core's specs cover fade timing with an injected
// clock), so a fixed clock makes them deterministic.
const FIXED_NOW = 1_800_000_000_000;
Date.now = () => FIXED_NOW;
