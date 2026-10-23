// Keep the real CLI's long-review and deadline scenarios runnable in seconds.
const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
AbortSignal.timeout = milliseconds => originalTimeout(milliseconds >= 90_000 ? milliseconds / 100 : milliseconds);
