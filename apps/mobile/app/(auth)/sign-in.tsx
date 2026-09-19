import { useState } from 'react';
import { Link } from 'expo-router';
import { View } from 'react-native';
import { signIn } from '@canteza/api';
import { BRAND, toAppError } from '@canteza/shared';
import { supabase } from '../../src/lib/supabase';
import { Body, Button, Field, FormError, Heading, Screen } from '../../src/components/ui';
import { useTheme } from '../../src/theme';

export default function SignIn() {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signIn(supabase, { email, password });
      // No navigation here: the session listener re-routes once the role is known.
    } catch (err) {
      setError(toAppError(err).userMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <View style={{ gap: t.space.xs, marginTop: t.space.xxxl }}>
        <Heading level="display">{BRAND.name}</Heading>
        <Body muted>{BRAND.tagline}</Body>
      </View>

      <View style={{ gap: t.space.lg, marginTop: t.space.xl }}>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@campus.edu"
          textContentType="emailAddress"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          onSubmitEditing={submit}
          returnKeyType="go"
        />
        <FormError message={error} />
        <Button
          label="Sign in"
          onPress={submit}
          loading={busy}
          disabled={email.length === 0 || password.length === 0}
        />
      </View>

      <View style={{ alignItems: 'center', gap: t.space.sm, marginTop: t.space.lg }}>
        <Body muted>New here?</Body>
        <Link href="/sign-up" asChild>
          <Button label="Create a student account" variant="secondary" onPress={() => {}} />
        </Link>
      </View>
    </Screen>
  );
}
