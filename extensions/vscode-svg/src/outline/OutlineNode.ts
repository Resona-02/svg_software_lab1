/** An editor-neutral symbol; all offsets use JavaScript / VSCode UTF-16 units. */
export interface OutlineNode {
  readonly name: string;
  readonly tagName: string;
  readonly start: number;
  readonly end: number;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly children: readonly OutlineNode[];
}
