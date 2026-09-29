import { Alert } from 'react-native';

/**
 * The app's two kinds of dialog, and the **only** file that calls `Alert.alert`.
 *
 * On a phone this is `Alert`. On the web it is `dialog.web.ts`, because react-native-web's
 * `Alert.alert` is a no-op: every "Reject this order?" and "Sign out?" would open nothing,
 * and since the action waits on the dialog's button, the button that opened it would
 * silently do nothing at all. `test/dialog.test.ts` fails if a screen calls `Alert`
 * directly again (rule 14a: a pattern that exists once stays consistent).
 */

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Styles the confirm button as dangerous where the platform can (iOS red). */
  destructive?: boolean;
  onConfirm: () => void;
  /** For callers that hold state open while asking -- a spinner to clear, say. */
  onCancel?: () => void;
};

/** A message with one button: an outcome to report, nothing to decide. */
export function notify(title: string, message: string): void {
  Alert.alert(title, message);
}

/** A question with two answers. Nothing happens until one is chosen. */
export function confirm(options: ConfirmOptions): void {
  Alert.alert(options.title, options.message, [
    { text: options.cancelLabel, style: 'cancel', onPress: options.onCancel },
    {
      text: options.confirmLabel,
      style: options.destructive ? 'destructive' : 'default',
      onPress: options.onConfirm,
    },
  ]);
}
