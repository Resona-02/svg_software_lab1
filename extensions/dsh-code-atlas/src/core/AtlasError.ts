/** Stable failures that both the UI and tool adapter can explain without guessing. */
export class AtlasError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = 'AtlasError'; }
}
