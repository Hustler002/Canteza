import { useEffect, useState } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

/**
 * Keyboard geometry, measured rather than guessed.
 *
 * Why this exists at all: six screens in this app take text input and not one of them
 * handled the keyboard, so a focused field near the bottom sat underneath it. The
 * worst case was the counter's menu screen, whose `Screen` does not scroll -- there
 * was no gesture that could bring the input back into view.
 *
 * Why no library: `react-native-keyboard-controller` is the usual answer and it is a
 * native module, so it is not in Expo Go. Adding it would force a development build
 * for every future device test. The platform already reports the real keyboard
 * rectangle in its events, which is the only number that matters and the one thing a
 * hardcoded offset can never get right across device sizes.
 *
 * Android fires `keyboardDidShow`/`keyboardDidHide`; iOS additionally fires the
 * `Will` pair early enough to animate with. Subscribing to the right pair per
 * platform is the difference between the layout moving with the keyboard and
 * snapping after it.
 */

const SHOW_EVENT = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE_EVENT = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

/** The keyboard's height in dp, or 0 when it is closed. */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener(SHOW_EVENT, (event: KeyboardEvent) => {
      setHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener(HIDE_EVENT, () => setHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}

/** True while the keyboard is open. Cheap enough to call anywhere. */
export function useKeyboardVisible(): boolean {
  return useKeyboardHeight() > 0;
}

/**
 * Dismiss on demand -- a sticky footer's own tap, or a "done" action.
 *
 * Tapping outside an input is handled by the ScrollView instead, via
 * `keyboardShouldPersistTaps="handled"` plus `keyboardDismissMode`, so that a tap on
 * another button still registers on the first tap rather than being swallowed to
 * close the keyboard.
 */
export function dismissKeyboard(): void {
  Keyboard.dismiss();
}
