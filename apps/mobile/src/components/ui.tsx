import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, type Theme } from '../theme';

/**
 * The base component set. Phase 4 composes these rather than inventing new ones, so
 * spacing, radii and states stay consistent across student, canteen and delivery.
 *
 * Everything reads tokens from useTheme(); no literal colours or spacings below.
 */

export function Screen({
  children,
  scroll = false,
  padded = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
}) {
  const t = useTheme();
  const inner: ViewStyle = { flex: 1, padding: padded ? t.space.lg : 0, gap: t.space.lg };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: t.color.background }}
      edges={['top', 'bottom']}
    >
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ padding: padded ? t.space.lg : 0, gap: t.space.lg }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={inner}>{children}</View>
      )}
    </SafeAreaView>
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

export function Field({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string | undefined }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space.sm }}>
      <Text style={[t.font.label, { color: t.color.textMuted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.color.textFaint}
        {...props}
        style={{
          minHeight: t.minTouchTarget,
          borderWidth: 1,
          borderColor: error ? t.color.danger : t.color.border,
          borderRadius: t.radius.md,
          paddingHorizontal: t.space.lg,
          color: t.color.text,
          backgroundColor: t.color.surface,
          fontSize: t.font.body.fontSize,
        }}
      />
      {error ? <Text style={[t.font.caption, { color: t.color.danger }]}>{error}</Text> : null}
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
