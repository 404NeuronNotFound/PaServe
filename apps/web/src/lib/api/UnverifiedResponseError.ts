/** A successful read whose payload failed the local response validation. */
export class UnverifiedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnverifiedResponseError";
  }
}
