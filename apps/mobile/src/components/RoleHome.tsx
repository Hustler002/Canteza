import { View } from 'react-native';
import { isAwaitingOnboarding } from '@canteza/api';
import { BRAND, formatPaise, PLATFORM_DEFAULTS } from '@canteza/shared';
import { useIdentity, useSession } from '../lib/session';
import { Badge, Body, Button, Card, EmptyState, Heading, Screen } from './ui';
import { useTheme } from '../theme';

/**
 * The signed-in shell each role lands on. Phase 4 replaces the body of these with
 * the real screens; what is here already is real -- the identity, role and canteen
 * are read from the database through RLS, not faked.
 */
export function RoleHome({
  title,
  subtitle,
  next,
}: {
  title: string;
  subtitle: string;
  next: string;
}) {
  const t = useTheme();
  const identity = useIdentity();
  const { signOut } = useSession();

  if (isAwaitingOnboarding(identity)) {
    return (
      <Screen>
        <EmptyState
          title="Waiting for setup"
          body={`Your ${identity.role} account has not been linked to a canteen yet. An admin needs to finish onboarding it.`}
        />
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={{ gap: t.space.xs, marginTop: t.space.lg }}>
        <Badge label={identity.role.toUpperCase()} tone="primary" />
        <Heading level="display">{title}</Heading>
        <Body muted>{subtitle}</Body>
      </View>

      <Card>
        <Heading level="heading">Signed in</Heading>
        <Body>{identity.profile.full_name || identity.email || 'Unnamed account'}</Body>
        <Body muted>{identity.email ?? ''}</Body>
        {identity.canteenId ? <Body muted>Canteen: {identity.canteenId}</Body> : null}
      </Card>

      <Card>
        <Heading level="heading">Next</Heading>
        <Body muted>{next}</Body>
      </Card>

      <Card>
        <Heading level="heading">How {BRAND.name} charges</Heading>
        <Body muted>
          Delivery is {formatPaise(PLATFORM_DEFAULTS.deliveryFeePaise)}, of which{' '}
          {formatPaise(PLATFORM_DEFAULTS.platformFeePaise)} keeps the app running. The canteen keeps
          every rupee of the food.
        </Body>
      </Card>

      <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}
