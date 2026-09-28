// All site-specific selectors live here. Missing evidence means no optimization.
const TURN = '[data-testid^="conversation-turn-"]';
const ROLE =
  '[data-message-author-role="user"], [data-message-author-role="assistant"]';
const COMPOSER =
  'form, [contenteditable="true"], [role="textbox"], #prompt-textarea';
export class ChatGPTDomAdapter {
  constructor(private doc: Document = document) {}
  isComposerRelated(el: HTMLElement): boolean {
    return (
      !!el.closest(COMPOSER) ||
      !!el.querySelector('textarea, [contenteditable="true"], [role="textbox"]')
    );
  }
  hasStructuralSignal(node: Node): boolean {
    return (
      node instanceof HTMLElement &&
      (node.matches(`${TURN}, ${ROLE}, main, [role="main"]`) ||
        !!node.querySelector(`${TURN}, ${ROLE}, main, [role="main"]`))
    );
  }
  findTurnFromNode(node: Node): HTMLElement | null {
    const el = node instanceof HTMLElement ? node : node.parentElement;
    if (!el || this.isComposerRelated(el)) return null;
    for (
      let turn = el.closest<HTMLElement>(`${TURN}, article`);
      turn;
      turn =
        turn.parentElement?.closest<HTMLElement>(`${TURN}, article`) ?? null
    ) {
      if (this.valid(turn) && !this.hasValidAncestor(turn)) return turn;
    }
    return null;
  }
  valid(el: HTMLElement): boolean {
    if (this.isComposerRelated(el) || !el.closest('main, [role="main"]'))
      return false;
    if (el.querySelector(TURN)) return false;
    const roles = (el.matches(ROLE) ? 1 : 0) + el.querySelectorAll(ROLE).length;
    // A semantic article alone is too ambiguous. Never manage a bare inner role node.
    if (roles !== 1) return false;
    if (!el.matches(TURN) && !el.matches("article")) return false;
    const parent = el.parentElement;
    if (!parent) return false;
    const rect = el.getBoundingClientRect(),
      width = parent.getBoundingClientRect().width;
    return width > 0 && rect.width >= width * 0.5 && rect.height > 0;
  }
  private hasValidAncestor(el: HTMLElement): boolean {
    for (
      let parent = el.parentElement?.closest<HTMLElement>(`${TURN}, article`);
      parent;
      parent = parent.parentElement?.closest<HTMLElement>(`${TURN}, article`)
    )
      if (this.valid(parent)) return true;
    return false;
  }
  findAddedTurns(subtree: HTMLElement): HTMLElement[] {
    const enclosing = this.findTurnFromNode(subtree);
    const nodes = [
      ...(enclosing ? [enclosing] : []),
      subtree,
      ...subtree.querySelectorAll<HTMLElement>(`${TURN}, article`),
    ];
    return [...new Set(nodes)].filter(
      (el) =>
        (el.matches(TURN) || el.matches("article")) &&
        this.valid(el) &&
        !this.hasValidAncestor(el),
    );
  }
  findTurns(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(`${TURN}, article`)].filter(
      (el) => this.valid(el) && !this.hasValidAncestor(el),
    );
  }
  findConversationRoot(): HTMLElement | null {
    const roots = [
      ...this.doc.querySelectorAll<HTMLElement>('main, [role="main"]'),
    ].filter((root) => this.findTurns(root).length > 0);
    return roots.length === 1 ? roots[0] : null;
  }
  findScrollRoot(root: HTMLElement, firstTurn?: HTMLElement): HTMLElement {
    // Start at a turn's parent: ChatGPT may place the scroller inside <main>.
    const first = firstTurn ?? this.findTurns(root)[0];
    for (
      let el = first?.parentElement;
      el && el !== this.doc.body;
      el = el.parentElement
    ) {
      if (
        /(auto|scroll)/.test(getComputedStyle(el).overflowY) &&
        el.clientHeight > 0
      )
        return el;
    }
    return this.doc.scrollingElement as HTMLElement;
  }
}
