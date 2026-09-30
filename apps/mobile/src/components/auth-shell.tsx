import type { ReactNode } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { BRAND } from '@canteza/shared';
import { useTheme } from '../theme';
import { LogoMark } from './logo';
import { FadeIn } from './motion';
import { Card, Screen } from './ui';

/**
 * The frame for signing in and signing up: the brand, then the form.
 *
 * This is the first thing a new student sees, so it says what Canteza is before it asks
 * for anything -- a saffron panel with the name, the promise and three facts. On a
 * phone the panel sits above the form; in a browser window wide enough, beside it, so a
 * laptop does not show a form floating alone in the middle of a very large page.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= t.layout.gridBreakpoint;

  return (
    <Screen scroll width="wide">
      <View
        style={{
          flexDirection: wide ? 'row' : 'column',
          alignItems: wide ? 'stretch' : undefined,
          gap: wide ? t.space.xxl : t.space.lg,
          marginTop: wide ? t.space.xxxl : t.space.sm,
        }}
      >
        <View style={wide ? { flex: 1 } : undefined}>
          <BrandPanel tall={wide} />
        </View>

        <FadeIn index={1} style={wide ? { flex: 1, justifyContent: 'center' } : undefined}>
          <Card style={{ padding: t.space.xl, gap: t.space.lg }}>
            <View style={{ gap: t.space.xs }}>
              <Text style={[t.font.display, { color: t.color.text, fontSize: 26, lineHeight: 32 }]}>
                {title}
              </Text>
              <Text style={[t.font.body, { color: t.color.textMuted }]}>{subtitle}</Text>
            </View>
            {children}
          </Card>
          {footer ? <View style={{ marginTop: t.space.lg, gap: t.space.sm }}>{footer}</View> : null}
        </FadeIn>
      </View>
    </Screen>
  );
}

const PROMISES = [
  { glyph: '🛵', label: 'Delivered to your room' },
  { glyph: '📍', label: 'Track every step live' },
  { glyph: '💸', label: 'Pay online or in cash' },
];

function BrandPanel({ tall }: { tall: boolean }) {
  const t = useTheme();

  return (
    <FadeIn
      index={0}
      style={{
        flex: tall ? 1 : undefined,
        backgroundColor: t.color.primary,
        borderRadius: t.radius.xl,
        padding: t.space.xl,
        paddingVertical: tall ? t.space.xxxl : t.space.xl,
        gap: t.space.lg,
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {/* Soft circles in the corners: depth without a gradient, which would need a
       * native module the phone build does not have. Decoration only. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          position: 'absolute',
          width: 260,
          height: 260,
          borderRadius: 130,
          top: -110,
          right: -80,
          backgroundColor: t.color.onPrimary,
          opacity: 0.1,
        }}
      />
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          position: 'absolute',
          width: 180,
          height: 180,
          borderRadius: 90,
          bottom: -90,
          left: -50,
          backgroundColor: t.color.primaryStrong,
          opacity: 0.6,
        }}
      />

      {/* The mark reversed, white on saffron -- the brand sheet's lockup for a saffron field. */}
      <LogoMark size={tall ? 72 : 56} tone="reversed" />

      <View style={{ gap: t.space.xs }}>
        <Text
          accessibilityRole="header"
          style={[
            t.font.display,
            { color: t.color.onPrimary, fontSize: tall ? 40 : 32, lineHeight: tall ? 46 : 38 },
          ]}
        >
          {BRAND.name}
        </Text>
        <Text style={[t.font.heading, { color: t.color.onPrimary, opacity: 0.92 }]}>
          {BRAND.tagline}
        </Text>
      </View>

      <View style={{ gap: t.space.sm }}>
        {PROMISES.map((promise) => (
          <View
            key={promise.label}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.space.sm,
              alignSelf: 'flex-start',
              paddingHorizontal: t.space.md,
              paddingVertical: t.space.xs + 2,
              borderRadius: t.radius.pill,
              backgroundColor: t.color.onPrimaryVeil,
            }}
          >
            <Text accessibilityElementsHidden style={t.font.label}>
              {promise.glyph}
            </Text>
            <Text style={[t.font.label, { color: t.color.onPrimary }]}>{promise.label}</Text>
          </View>
        ))}
      </View>
    </FadeIn>
  );
}
