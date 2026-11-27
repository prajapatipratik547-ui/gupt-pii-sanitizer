import { h } from './dom';

const TOAST_MS = 2800;
const MAX_LOG_ENTRIES = 60;

/** Non-blocking status message (role="status" in the markup, so screen readers announce it). */
export function createToaster(el: HTMLElement): (message: string) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (message) => {
    el.textContent = message;
    el.classList.add('is-visible');
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('is-visible'), TOAST_MS);
  };
}

/**
 * Session activity log. Callers pass descriptions of actions only — never the
 * text being sanitized — and the log lives in memory for this tab alone.
 */
export function createActivityLog(list: HTMLElement): (message: string) => void {
  list.append(h('li', { class: 'activity-empty', text: 'No activity yet.' }));
  return (message) => {
    const now = new Date();
    list.querySelector('.activity-empty')?.remove();
    list.prepend(h('li', {}, h('time', { datetime: now.toISOString(), text: now.toLocaleTimeString('en-GB') }), h('span', { text: message })));
    while (list.children.length > MAX_LOG_ENTRIES) list.lastElementChild?.remove();
  };
}
