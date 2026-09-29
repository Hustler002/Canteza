import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Platform, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';

/**
 * Motion, in one place, and always optional.
 *
 * Everything here is skipped when the device asks for reduced motion -- a setting people
 * turn on because movement makes them unwell, so honouring it is not a nicety. On the
 * phone the animations run on the native driver, so a list arriving costs the JavaScript
 * thread nothing while it is also parsing the data that list came from.
 */

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduced(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

/**
 * A list item arriving: a short fade and an 8pt rise, staggered by its position.
 *
 * Only the first screenful animates (`index` below 10) and the stagger is capped, so a
 * long list never makes anyone wait for row forty, and a row scrolled back into view
 * does not replay an entrance it already made.
 */
export function FadeIn({
  children,
  index = 0,
  style,
}: {
  children: ReactNode;
  index?: number;
  style?: ViewStyle | undefined;
}) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const animate = index < 10 && !reduced;
  const progress = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: t.motion.enter,
      delay: Math.min(index, 6) * t.motion.stagger,
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [animate, index, progress, t.motion.enter, t.motion.stagger]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Web-only style: a pointer cursor and a short transition, so a hover or a press
 * eases instead of snapping. React Native Web understands these keys; the phone has no
 * pointer and no CSS, so they are simply absent there rather than ignored noise.
 */
export function webInteractive(duration: number): ViewStyle {
  if (Platform.OS !== 'web') return {};
  return {
    cursor: 'pointer',
    transitionProperty: 'transform, box-shadow, background-color, opacity, border-color',
    transitionDuration: `${duration}ms`,
    transitionTimingFunction: 'ease-out',
  } as ViewStyle;
}

/** React Native Web adds `hovered` to a Pressable's state; the phone never sets it. */
export type InteractionState = { pressed: boolean; hovered?: boolean };
