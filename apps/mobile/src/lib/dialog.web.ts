import type { ConfirmOptions } from './dialog';

/**
 * The web half of `dialog.ts`, picked by Metro's `.web.ts` resolution.
 *
 * The browser's own dialogs, deliberately plain. They block, they are keyboard- and
 * screen-reader-accessible for free, and they cannot be styled -- which is the point of
 * using them here rather than building a modal: the phone's dialogs are the system's too.
 *
 * The one thing lost is the button labels. `window.confirm` only offers OK and Cancel,
 * so both labels are spelled out under the question -- "OK: Reject · Cancel: Keep it" --
 * because a bare OK on "Reject this order?" does not say which way it goes.
 */

export function notify(title: string, message: string): void {
  globalThis.alert?.(`${title}\n\n${message}`);
}

export function confirm(options: ConfirmOptions): void {
  const question = `${options.title}\n\n${options.message}\n\nOK: ${options.confirmLabel}  ·  Cancel: ${options.cancelLabel}`;
  if (globalThis.confirm?.(question)) options.onConfirm();
  else options.onCancel?.();
}
