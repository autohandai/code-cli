export async function resolveRuntimeContextWindow(
  discover: (signal: AbortSignal) => Promise<number | undefined>,
  signal?: AbortSignal,
): Promise<number | undefined> {
  if (signal?.aborted) return undefined;
  const deadline = AbortSignal.timeout(2000);
  const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  if (boundedSignal.aborted) return undefined;
  let abort: () => void = () => {};
  const cancelled = new Promise<undefined>((resolve) => {
    abort = () => resolve(undefined);
    boundedSignal.addEventListener('abort', abort, { once: true });
  });
  try {
    const value = await Promise.race([discover(boundedSignal), cancelled]);
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  } finally {
    boundedSignal.removeEventListener('abort', abort);
  }
}
