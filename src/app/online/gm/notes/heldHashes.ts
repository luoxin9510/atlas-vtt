/** How many hashes that left the shared set are remembered, so their requests are still answered `asset-refused`. */
const REMEMBERED_GONE = 2_000;

/** The hashes the share holds now, and the recent ones it held and no longer does. */
export class HeldHashes {
  private held = new Set<string>();
  private readonly gone = new Set<string>();

  has(hash: string): boolean {
    return this.held.has(hash);
  }

  wasHeld(hash: string): boolean {
    return this.gone.has(hash);
  }

  /** Takes the hashes held now; those that were held before and are not are returned. */
  replace(now: ReadonlySet<string>): string[] {
    const left = [...this.held].filter((hash) => !now.has(hash));
    for (const hash of left) this.gone.add(hash);
    for (const hash of now) this.gone.delete(hash);
    for (const hash of this.gone) {
      if (this.gone.size <= REMEMBERED_GONE) break;
      this.gone.delete(hash);
    }
    this.held = new Set(now);
    return left;
  }
}
