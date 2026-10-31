import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage<{
  signal: AbortSignal;
  databaseWorkload?: 'analytics' | 'orders' | 'other';
}>();
export const requestSignal = () => requestContext.getStore()?.signal;
export function throwIfRequestAborted(): void {
  requestSignal()?.throwIfAborted();
}

/** Native fetch also aborts response-body reads when this signal expires. */
export const boundedFetch: typeof fetch = (input, init) => {
  throwIfRequestAborted();
  const signals = [AbortSignal.timeout(10_000)];
  const incoming = requestSignal();
  if (incoming) signals.push(incoming);
  if (init?.signal) signals.push(init.signal);
  if (input instanceof Request) signals.push(input.signal);
  return fetch(input, { ...init, signal: AbortSignal.any(signals) });
};
