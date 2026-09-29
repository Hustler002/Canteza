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
import { webInteractive, type InteractionState } from './motion';
import { Icon, type IconName } from './patterns';

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

type ColumnWidth = 'content' | 'wide';
const ColumnContext = createContext<ColumnWidth>('content');

/**
 * The centred column that keeps a page readable on a laptop.
 *
 * On a phone it is the full width and changes nothing. In a browser window it stops at
 * `layout.content` (or `layout.wide` for a browsing grid) and sits in the middle, with
 * the page background either side -- a 1400px-wide menu row is a row nobody can read.
 * A `Screen` applies it to its own content; a screen that renders its own `FlatList`
 * passes `useColumn()` to the list's `contentContainerStyle` and wraps its header in
 * `<Column>`, so the list still scrolls from anywhere in the window.
 */
export function useColumn(): ViewStyle {
  const t = useTheme();
  const width = useContext(ColumnContext);
  return columnStyle(t, width);
}

/** The same column, for a screen component that renders its `Screen` rather than sits in one. */
export function columnStyle(t: Theme, width: ColumnWidth = 'content'): ViewStyle {
  return { width: '100%', maxWidth: t.layout[width], alignSelf: 'center' };
}

export function Column({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const column = useColumn();
  return <View style={[column, style]}>{children}</View>;
}

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
 *
 * `width` picks the column (`useColumn`): a reading column by default, `wide` for the
 * screens that lay cards out in a grid.
 */
export function Screen({
  children,
  scroll = false,
  padded = true,
  footer,
  width = 'content',
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  footer?: ReactNode;
  width?: ColumnWidth;
}) {
  const t = useTheme();
  const pad = padded ? t.space.lg : 0;
  const column: ViewStyle = { width: '100%', maxWidth: t.layout[width], alignSelf: 'center' };
  const inner: ViewStyle = { flex: 1, padding: pad, gap: t.space.lg, ...column };

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
        <ColumnContext.Provider value={width}>
          <ScrollAssistContext.Provider value={assist}>
            {scroll ? (
              <ScrollView
                ref={scrollRef}
                contentContainerStyle={{
                  padding: pad,
                  gap: t.space.lg,
                  paddingBottom: pad + t.space.xl,
                  ...column,
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
            ) : padded ? (
              <View style={inner}>{children}</View>
            ) : (
              // Unpadded screens own their lists; each list centres itself with
              // `useColumn()` so the scroll area stays the full window.
              <View style={{ flex: 1, gap: t.space.lg }}>{children}</View>
            )}
            {footer ? <StickyFooter>{footer}</StickyFooter> : null}
          </ScrollAssistContext.Provider>
        </ColumnContext.Provider>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * The sticky action area. Floats over content with a lifted shadow so a long list
 * visibly runs underneath it rather than appearing to stop short.
 *
 * It carries its own bottom safe-area inset, which is why `Screen` drops the bottom
 * edge when a footer is present. The band is full width; what is in it keeps to the
 * page's column, so a checkout button on a laptop is not 1200px wide.
 */
export function StickyFooter({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const column = useColumn();

  return (
    <View
      style={[
        {
          backgroundColor: t.color.surface,
          borderTopLeftRadius: t.radius.lg,
          borderTopRightRadius: t.radius.lg,
          paddingHorizontal: t.space.lg,
          paddingTop: t.space.md,
          paddingBottom: Math.max(insets.bottom, t.space.md),
        },
        t.elevation.raised,
      ]}
    >
      <View style={[column, { gap: t.space.sm }]}>{children}</View>
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
    <Text style={[t.font.body, { color: muted ? t.color.textMuted : t.color.text }]}>
      {children}
    </Text>
  );
}

/** Small capitals above a group of content: "DELIVERING TO", "BILL DETAILS". */
export function Overline({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text style={[t.font.overline, { color: t.color.textMuted, textTransform: 'uppercase' }]}>
      {children}
    </Text>
  );
}

/**
 * A surface. White on the stone page, lifted by a shadow rather than drawn with a line.
 *
 * With `onPress` it becomes the whole tap target -- a canteen, an order -- and answers
 * a finger by sinking slightly and a mouse by rising, so it is obvious the entire card
 * is the button and not only the text on it. `highlight` gives it a brand outline for
 * the one card on a screen that is about something happening now.
 */
export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
  highlight = false,
  padding = 'lg',
}: {
  children: ReactNode;
  style?: ViewStyle | undefined;
  onPress?: (() => void) | undefined;
  accessibilityLabel?: string | undefined;
  highlight?: boolean;
  padding?: 'none' | 'md' | 'lg';
}) {
  const t = useTheme();
  const base: ViewStyle = {
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    borderWidth: highlight ? 1.5 : 1,
    borderColor: highlight ? t.color.primary : t.color.cardBorder,
    padding: padding === 'none' ? 0 : padding === 'md' ? t.space.md : t.space.lg,
    gap: t.space.md,
    ...t.elevation.card,
  };

  if (!onPress) return <View style={[base, style]}>{children}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={(state) => {
        const { pressed, hovered } = state as InteractionState;
        return [
          base,
          webInteractive(t.motion.quick),
          hovered && !pressed ? t.elevation.lifted : null,
          {
            transform: [
              { scale: pressed ? 0.985 : 1 },
              { translateY: hovered && !pressed ? -2 : 0 },
            ],
          },
          style,
        ];
      }}
    >
      {children}
    </Pressable>
  );
}

type Tone = 'neutral' | 'primary' | 'success' | 'danger' | 'info' | 'warning';

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
    case 'warning':
      return { bg: t.color.warningSoft, fg: t.color.warning };
    default:
      return { bg: t.color.surfaceAlt, fg: t.color.textMuted };
  }
}

export function Badge({
  label,
  tone = 'neutral',
  dot = false,
}: {
  label: string;
  tone?: Tone;
  /** A leading dot, for live state ("Open", "Online") rather than a category. */
  dot?: boolean;
}) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.xs + 2,
        backgroundColor: c.bg,
        paddingHorizontal: t.space.sm + 2,
        paddingVertical: t.space.xs,
        borderRadius: t.radius.pill,
      }}
    >
      {dot ? (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.fg }} />
      ) : null}
      <Text style={[t.font.label, { color: c.fg, fontSize: 12 }]}>{label}</Text>
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';

function buttonColors(t: Theme, variant: ButtonVariant) {
  switch (variant) {
    case 'primary':
      return {
        bg: t.color.primary,
        hover: t.color.primaryStrong,
        fg: t.color.onPrimary,
        line: 'transparent',
      };
    case 'danger':
      return {
        bg: t.color.dangerSoft,
        hover: t.color.dangerSoft,
        fg: t.color.danger,
        line: 'transparent',
      };
    case 'success':
      return {
        bg: t.color.successStrong,
        hover: t.color.successStrong,
        fg: t.color.onPrimary,
        line: 'transparent',
      };
    case 'ghost':
      return {
        bg: 'transparent',
        hover: t.color.surfaceAlt,
        fg: t.color.primary,
        line: 'transparent',
      };
    default:
      return {
        bg: t.color.surface,
        hover: t.color.surfaceAlt,
        fg: t.color.text,
        line: t.color.border,
      };
  }
}

/**
 * The button.
 *
 * `trailing` puts a second, quieter piece of text at the far end -- the total on a
 * checkout button, "View cart ›" on the cart bar -- so the action and its consequence
 * are read in one glance. A press sinks the button a touch (scale 0.97); on the web a
 * hover deepens it. Danger is a soft red with red text rather than a solid red slab:
 * reject and cancel should be findable, never the loudest thing on the screen.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  trailing,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  trailing?: string | undefined;
  icon?: IconName | undefined;
}) {
  const t = useTheme();
  const isDisabled = disabled || loading;
  const c = buttonColors(t, variant);
  const height = size === 'sm' ? 38 : size === 'lg' ? 56 : t.minTouchTarget;
  const text = size === 'sm' ? t.font.label : t.font.heading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={trailing ? `${label}, ${trailing}` : label}
      style={(state) => {
        const { pressed, hovered } = state as InteractionState;
        return [
          {
            minHeight: height,
            borderRadius: size === 'sm' ? t.radius.sm : t.radius.md,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: trailing ? 'space-between' : 'center',
            gap: t.space.sm,
            paddingHorizontal: size === 'sm' ? t.space.md : t.space.lg + 2,
            backgroundColor: hovered && !isDisabled ? c.hover : c.bg,
            borderWidth: variant === 'secondary' ? 1 : 0,
            borderColor: c.line,
            opacity: isDisabled ? 0.45 : 1,
            transform: [{ scale: pressed && !isDisabled ? 0.97 : 1 }],
          },
          variant === 'primary' && !isDisabled ? t.elevation.card : null,
          webInteractive(t.motion.instant),
        ];
      }}
    >
      {loading ? (
        <View style={{ flex: trailing ? 1 : 0, alignItems: 'center' }}>
          <ActivityIndicator color={c.fg} />
        </View>
      ) : (
        <>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, flexShrink: 1 }}
          >
            {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 19} color={c.fg} /> : null}
            <Text style={[text, { color: c.fg }]} numberOfLines={1}>
              {label}
            </Text>
          </View>
          {trailing ? (
            <Text style={[text, { color: c.fg }]} numberOfLines={1}>
              {trailing}
            </Text>
          ) : null}
        </>
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
 *
 * At rest it is a filled, borderless well; focused it turns white with a brand ring,
 * so the field being typed into is unmistakable without a heavy outline on every
 * field that is not.
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
      <Text style={[t.font.label, { color: t.color.text }]}>{label}</Text>
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
        style={[
          {
            minHeight: multiline ? t.minTouchTarget * 2.25 : t.minTouchTarget + 4,
            maxHeight: multiline ? t.minTouchTarget * 4 : undefined,
            borderWidth: 1.5,
            borderColor,
            borderRadius: t.radius.md,
            paddingHorizontal: t.space.lg,
            paddingVertical: multiline ? t.space.md : 0,
            color: t.color.text,
            backgroundColor: focused ? t.color.surface : t.color.surfaceAlt,
            fontSize: t.font.body.fontSize,
            ...(t.font.body.fontFamily ? { fontFamily: t.font.body.fontFamily } : {}),
          },
          // The browser's own focus outline would sit outside the brand ring.
          Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
          webInteractive(t.motion.quick),
        ]}
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
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: t.space.md,
        backgroundColor: t.color.background,
      }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: t.radius.lg,
          backgroundColor: t.color.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={t.color.primary} />
      </View>
      <Text style={[t.font.label, { color: t.color.textMuted }]}>{label}</Text>
    </View>
  );
}

/**
 * Nothing here -- said kindly, with a way forward when there is one.
 *
 * The emoji is decoration in a soft circle, hidden from screen readers; the title and
 * body carry the meaning. `action` is the obvious next step ("Browse canteens"), so an
 * empty screen is never a dead end.
 */
export function EmptyState({
  title,
  body,
  emoji = '🍽️',
  action,
}: {
  title: string;
  body?: string;
  emoji?: string;
  action?: { label: string; onPress: () => void } | undefined;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: t.space.md,
        padding: t.space.xl,
      }}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 88,
          height: 88,
          borderRadius: 44,
          backgroundColor: t.color.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: t.space.xs,
        }}
      >
        <Text style={{ fontSize: 40 }}>{emoji}</Text>
      </View>
      <Text style={[t.font.title, { color: t.color.text, textAlign: 'center' }]}>{title}</Text>
      {body ? (
        <Text
          style={[t.font.body, { color: t.color.textMuted, textAlign: 'center', maxWidth: 360 }]}
        >
          {body}
        </Text>
      ) : null}
      {action ? (
        <View style={{ marginTop: t.space.sm }}>
          <Button label={action.label} onPress={action.onPress} variant="secondary" size="sm" />
        </View>
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
        backgroundColor: t.color.background,
      }}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: t.color.dangerSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 32 }}>😕</Text>
      </View>
      <Text style={[t.font.title, { color: t.color.text, textAlign: 'center' }]}>
        Something went wrong
      </Text>
      <Text style={[t.font.body, { color: t.color.textMuted, textAlign: 'center', maxWidth: 360 }]}>
        {message}
      </Text>
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
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        gap: t.space.sm,
        backgroundColor: t.color.dangerSoft,
        borderRadius: t.radius.md,
        padding: t.space.md,
      }}
    >
      <Text style={[t.font.bodyStrong, { color: t.color.danger }]}>!</Text>
      <Text style={[t.font.body, { color: t.color.danger, flex: 1 }]}>{message}</Text>
    </View>
  );
}
