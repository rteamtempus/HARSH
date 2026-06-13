import { ErrorHandler, Injectable } from '@angular/core';

/**
 * TEMPORARY debugging aid. Renders any uncaught error visibly on screen (not
 * just the console) so the display can be debugged on a phone/TV where dev
 * tools aren't reachable. Remove once the board render crash is fixed.
 */
@Injectable()
export class VisibleErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    // Keep the default behaviour too.
    // eslint-disable-next-line no-console
    console.error(error);
    try {
      const id = 'harsh-error-overlay';
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.style.cssText = [
          'position:fixed', 'inset:0', 'z-index:99999',
          'background:#ffffff', 'color:#aa0000',
          'font:13px/1.45 monospace', 'padding:16px',
          'overflow:auto', 'white-space:pre-wrap', 'word-break:break-word',
        ].join(';');
        document.body.appendChild(el);
      }
      const e = error as { message?: string; stack?: string };
      const detail = e && (e.stack || e.message)
        ? `${e.message ?? ''}\n\n${e.stack ?? ''}`
        : String(error);
      el.textContent = `DISPLAY ERROR (debug build):\n\n${detail}`;
    } catch {
      /* ignore — best-effort overlay */
    }
  }
}
