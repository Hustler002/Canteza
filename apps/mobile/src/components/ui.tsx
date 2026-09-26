import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardHeight } from '../lib/keyboard';
import { useTheme, type Theme } from '../theme';

/**
 * The base component set. Phase 4 composes these rather than inventing new ones, so
 * spacing, radii and states stay consistent across student, canteen and delivery.
 *
 * Everything reads tokens from useTheme(); no literal colours or spacings below.
 */

/**
 * How a `Field` tells its `Screen` which input is focused.
 *
 * The screen cannot know, and the field cannot scroll, so the field registers itself
 * and the screen does the arithmetic. Any input rendered inside a scrolling `Screen`
 * gets this for free; one rendered outside simply finds no provider and does
 * nothing, which is why the context is nullable rather than throwing.
 */
type ScrollAssist = { setActiveInput: (node: MeasurableInput | null) => void };
type MeasurableInput = {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
};

const ScrollAssistContext = createContext<ScrollAssist | null>(null);

/**
 * Every screen's frame, and the one place the keyboard is handled.
 *
 * Handling it here rather than per screen is deliberate: six screens take text input
 * and every one of them was getting it wrong, because getting it right is fiddly and
 * nobody remembers to. A screen now opts into nothing and cannot forget.
 *
 * How it works on each platform, since they genuinely differ:
 *
 * - **Android** resizes the app window when the keyboard opens
 *   (`softwareKeyboardLayoutMode: "resize"`, stated explicitly in app.json rather
 *   than left to the default). The ScrollView shrinks with it, so the content
 *   scrolls and a `footer` lands directly above the keyboard for free.
 * - **iOS** never resizes, so `KeyboardAvoidingView` adds the padding instead, and
 *   `automaticallyAdjustKeyboardInsets` scrolls the focused field into view.
 *
 * On top of both, `reveal()` below scrolls the focused field clear of the keyboard
 * using measured geometry, so the requirement holds even where the platform's own
 * behaviour does not.
 *
 * `footer` is the sticky action area -- a checkout CTA, a submit button. It sits
 * outside the ScrollView so it never scrolls away, and inside the
 * KeyboardAvoidingView so it rides above the keyboard rather than under it.
 */
export function Screen({
  children,
  scroll = false,
  padded = true,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  footer?: ReactNode;
}) {
  const t = useTheme();
  const pad = padded ? t.space.lg : 0;
  const inner: ViewStyle = { flex: 1, padding: pad, gap: t.space.lg };

  const scrollRef = useRef<ScrollView>(null);
  const offset = useRef(0);
  const activeInput = useRef<MeasurableInput | null>(null);
  const keyboard = useKeyboardHeight();
  const { height: windowHeight } = useWindowDimensions();

  /**
   * Scroll the focused input clear of the keyboard, if it is not already.
   *
   * Everything here is measured at the moment it runs -- the input's position from
   * `measureInWindow`, the keyboard's height from its own event, the window from
   * the current dimensions. There is no device-specific constant, which is the
   * whole point: a number tuned on one handset is wrong on the next one.
   */
  const reveal = useCallback(() => {
    const node = activeInput.current;
    if (!node || keyboard <= 0) return;

    node.measureInWindow((_x, y, _width, height) => {
      const keyboardTop = windowHeight - keyboard;
      const wantedBottom = y + height + t.space.lg;
      const overlap = wantedBottom - keyboardTop;
      if (overlap > 0) {
        scrollRef.current?.scrollTo({ y: offset.current + overlap, animated: true });
      }
    });
  }, [keyboard, windowHeight, t.space.lg]);

  // The keyboard opening (or growing, as a suggestion strip appears) is the trigger.
  // Reacting to the event rather than guessing a delay after focus is what makes
  // this reliable on a slow device, where a fixed timeout loses the race.
  useEffect(reveal, [reveal]);

  const assist = useMemo<ScrollAssist>(
    () => ({
      setActiveInput: (node) => {
        activeInput.current = node;
        // Moving between fields while the keyboard is already up produces no
        // keyboard event, so that case has to ask for the scroll itself.
        if (node && keyboard > 0) requestAnimationFrame(reveal);
      },
    }),
    [keyboard, reveal],
  );

  // A sticky footer already covers the bottom inset, so letting SafeAreaView pad it
  // too would leave a stripe of background under the bar.
  const edges = footer ? (['top'] as const) : (['top', 'bottom'] as const);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.color.background }} edges={edges}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        {...(Platform.OS === 'ios' ? { behavior: 'padding' as const } : {})}
      >
        <ScrollAssistContext.Provider value={assist}>
          {scroll ? (
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={{
                padding: pad,
                gap: t.space.lg,
                paddingBottom: pad + t.space.xl,
              }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={(event) => {
                offset.current = event.nativeEvent.contentOffset.y;
              }}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={inner}>{children}</View>
          )}
          {footer ? <StickyFooter>{footer}</StickyFooter> : null}
        </ScrollAssistContext.Provider>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * The sticky action area. Floats over content with a top border and a lifted shadow
 * so a long list visibly runs underneath it rather than appearing to stop short.
 *
 * It carries its own bottom safe-area inset, which is why `Screen` drops the bottom
 * edge when a footer is present.
 */
export function StickyFooter({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        {
          backgroundColor: t.color.surface,
          borderTopWidth: 1,
          borderTopColor: t.color.border,
          paddingHorizontal: t.space.lg,
          paddingTop: t.space.md,
          paddingBottom: Math.max(insets.bottom, t.space.md),
          gap: t.space.sm,
        },
        t.elevation.raised,
      ]}
    >
      {children}
    </View>
  );
}

export function Heading({
  children,
  level = 'title',
}: {
  children: ReactNode;
  level?: 'display' | 'title' | 'heading';
}) {
  const t = useTheme();
  return <Text style={[t.font[level], { color: t.color.text }]}>{children}</Text>;
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  const t = useTheme();
  return (
    <Text
      style={[t.font.body, { color: muted ? t.color.textMuted : t.color.text, lineHeight: 22 }]}
    >
      {children}
    </Text>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.color.surface,
          borderRadius: t.radius.lg,
          borderWidth: 1,
          borderColor: t.color.border,
          padding: t.space.lg,
          gap: t.space.md,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

type Tone = 'neutral' | 'primary' | 'success' | 'danger' | 'info';

function toneColors(t: Theme, tone: Tone) {
  switch (tone) {
    case 'primary':
      return { bg: t.color.primarySoft, fg: t.color.primary };
    case 'success':
      return { bg: t.color.successSoft, fg: t.color.success };
    case 'danger':
      return { bg: t.color.dangerSoft, fg: t.color.danger };
    case 'info':
      return { bg: t.color.infoSoft, fg: t.color.info };
    default:
      return { bg: t.color.surfaceAlt, fg: t.color.textMuted };
  }
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: c.bg,
        paddingHorizontal: t.space.md,
        paddingVertical: t.space.xs,
        borderRadius: t.radius.pill,
      }}
    >
      <Text style={[t.font.label, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  const isDisabled = disabled || loading;

  const background =
    variant === 'primary' ? t.color.primary : variant === 'danger' ? t.color.danger : 'transparent';
  const foreground = variant === 'secondary' ? t.color.text : t.color.onPrimary;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        minHeight: t.minTouchTarget,
        borderRadius: t.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: t.space.lg,
        backgroundColor: background,
        borderWidth: variant === 'secondary' ? 1 : 0,
        borderColor: t.color.border,
        opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <Text style={[t.font.heading, { color: foreground }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/**
 * A labelled text input.
 *
 * `multiline` gets real handling rather than the default, which on Android is a
 * one-line-tall box that grows downward off the screen: it starts at a comfortable
 * few lines, aligns its text to the top, and scrolls inside itself once it fills up,
 * so a long comment never pushes the submit button away.
 *
 * `maxLength` turns on a live counter, but only once the user is close to the limit
 * -- a counter sitting at 0/280 before anyone has typed is noise, and a counter that
 * appears at 240 is information.
 */
export function Field({
  label,
  error,
  hint,
  ...props
}: TextInputProps & { label: string; error?: string | undefined; hint?: string | undefined }) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const assist = useContext(ScrollAssistContext);

  const multiline = props.multiline === true;
  const length = typeof props.value === 'string' ? props.value.length : 0;
  const limit = props.maxLength;
  const showCount = typeof limit === 'number' && length > limit * 0.75;

  const borderColor = error ? t.color.danger : focused ? t.color.primary : t.color.border;

  return (
    <View style={{ gap: t.space.sm }}>
      <Text style={[t.font.label, { color: t.color.textMuted }]}>{label}</Text>
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        placeholderTextColor={t.color.textFaint}
        {...props}
        onFocus={(event) => {
          setFocused(true);
          // Tell the enclosing Screen which input to keep above the keyboard.
          assist?.setActiveInput(inputRef.current);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          assist?.setActiveInput(null);
          props.onBlur?.(event);
        }}
        {...(multiline ? { textAlignVertical: 'top' as const } : {})}
        style={{
          minHeight: multiline ? t.minTouchTarget * 2.25 : t.minTouchTarget,
          maxHeight: multiline ? t.minTouchTarget * 4 : undefined,
          borderWidth: focused ? 2 : 1,
          borderColor,
          borderRadius: t.radius.md,
          paddingHorizontal: t.space.lg,
          paddingVertical: multiline ? t.space.md : 0,
          color: t.color.text,
          backgroundColor: t.color.surface,
          fontSize: t.font.body.fontSize,
        }}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.sm }}>
        <View style={{ flex: 1 }}>
          {error ? (
            <Text style={[t.font.caption, { color: t.color.danger }]}>{error}</Text>
          ) : hint ? (
            <Text style={[t.font.caption, { color: t.color.textMuted }]}>{hint}</Text>
          ) : null}
        </View>
        {showCount ? (
          <Text style={[t.font.caption, { color: t.color.textMuted }]}>
            {length}/{limit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The three states every data-backed screen owes the user. */

export function Loading({ label = 'Loading…' }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.space.md }}>
      <ActivityIndicator color={t.color.primary} />
      <Text style={[t.font.caption, { color: t.color.textMuted }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: t.space.sm,
        padding: t.space.xl,
      }}
    >
      <Heading level="heading">{title}</Heading>
      {body ? (
        <Text style={[t.font.body, { color: t.color.textMuted, textAlign: 'center' }]}>{body}</Text>
      ) : null}
    </View>
  );
}

/**
 * Shows the AppError's safe user message. The technical detail stays in logs — a
 * student should never read a Postgres sentence.
 */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: (() => void) | undefined;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: t.space.lg,
        padding: t.space.xl,
      }}
    >
      <Badge label="Something went wrong" tone="danger" />
      <Text style={[t.font.body, { color: t.color.text, textAlign: 'center' }]}>{message}</Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

/** Inline error above a form's submit button. */
export function FormError({ message }: { message: string | null }) {
  const t = useTheme();
  if (!message) return null;
  return (
    <View
      style={{
        backgroundColor: t.color.dangerSoft,
        borderRadius: t.radius.md,
        padding: t.space.md,
      }}
    >
      <Text style={[t.font.body, { color: t.color.danger }]}>{message}</Text>
    </View>
  );
}
