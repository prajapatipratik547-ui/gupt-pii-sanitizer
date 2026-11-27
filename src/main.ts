import './styles.css';
import { startApp } from './ui/app';

/**
 * Clickjacking guard. Static hosts like GitHub Pages cannot send
 * X-Frame-Options / frame-ancestors headers, so refuse to run inside a frame:
 * a hostile page could otherwise overlay Gupt and trick someone into pasting data.
 */
if (window.top !== window.self) {
  const notice = document.createElement('p');
  notice.className = 'framed-notice';
  notice.textContent = 'For your safety, Gupt does not run inside another website. Open it directly in its own tab.';
  document.body.replaceChildren(notice);
} else {
  startApp();
}
