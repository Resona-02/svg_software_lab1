/** Browser-like history: failed navigation never advances the cursor. */
export class NavigationHistory<T> {
  private entries: T[] = [];
  private cursor = -1;
  constructor(private readonly equal: (a: T, b: T) => boolean, private readonly capacity = 80) {}
  push(entry: T): void {
    if (this.cursor >= 0 && this.equal(this.entries[this.cursor]!, entry)) { this.entries[this.cursor] = entry; return; }
    this.entries = this.entries.slice(0, this.cursor + 1);
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();
    this.cursor = this.entries.length - 1;
  }
  target(offset: -1 | 1): { index: number; entry: T } | undefined {
    const index = this.cursor + offset;
    return index >= 0 && index < this.entries.length ? { index, entry: this.entries[index]! } : undefined;
  }
  commit(index: number): void { if (index >= 0 && index < this.entries.length) this.cursor = index; }
  get canBack(): boolean { return this.cursor > 0; }
  get canForward(): boolean { return this.cursor >= 0 && this.cursor < this.entries.length - 1; }
  trail(): readonly T[] { return this.entries.slice(0, this.cursor + 1); }
}
