/**
 * Interactions for the side-by-side panes: proportional scroll sync and
 * hover-linking a highlight to its counterpart on the other side.
 */
export interface DiffPanes {
  container: HTMLElement;
  original: HTMLElement;
  output: HTMLElement;
  /** Read on every scroll so the checkbox takes effect immediately. */
  syncEnabled: () => boolean;
}

export function bindDiffInteractions({ container, original, output, syncEnabled }: DiffPanes): void {
  let syncing = false;
  const sync = (from: HTMLElement, to: HTMLElement): void => {
    if (!syncEnabled() || syncing) return;
    syncing = true;
    const ratio = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
    to.scrollTop = ratio * (to.scrollHeight - to.clientHeight);
    // Release on the next frame so the echo scroll event from `to` is ignored.
    requestAnimationFrame(() => {
      syncing = false;
    });
  };
  original.addEventListener('scroll', () => sync(original, output), { passive: true });
  output.addEventListener('scroll', () => sync(output, original), { passive: true });

  let hovered: string | null = null;
  const setHover = (id: string | null): void => {
    if (hovered === id) return;
    for (const m of container.querySelectorAll('.pii.is-hover')) m.classList.remove('is-hover');
    hovered = id;
    if (id === null) return;
    for (const m of container.querySelectorAll(`.pii[data-eid="${id}"]`)) m.classList.add('is-hover');
  };
  container.addEventListener('mouseover', (e) => {
    const mark = (e.target as Element).closest<HTMLElement>('.pii[data-eid]');
    setHover(mark?.dataset.eid ?? null);
  });
  container.addEventListener('mouseleave', () => setHover(null));
}
