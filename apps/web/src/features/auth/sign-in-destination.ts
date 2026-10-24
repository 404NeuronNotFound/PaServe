/** Only resume the existing validated cashier destination, never an arbitrary URL. */
export function signInDestination(requestedPath: unknown): string {
  return typeof requestedPath === "string" &&
    /^\/app\/shops\/[a-zA-Z0-9-]+\/cashier\/?$/.test(requestedPath)
    ? requestedPath
    : "/app";
}
