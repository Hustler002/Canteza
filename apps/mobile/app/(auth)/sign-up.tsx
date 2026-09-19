import { useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { signIn, signUp, validatePassword } from '@campuseats/api';
import { toAppError } from '@campuseats/shared';
import { supabase } from '../../src/lib/supabase';
import { Body, Button, Field, FormError, Heading, Screen } from '../../src/components/ui';
import { useTheme } from '../../src/theme';

/**
 * Students only. Canteen staff and delivery partners are created by an admin, so
 * there is no role picker here to tamper with -- the signup trigger writes
 * `role = 'student'` server-side regardless of what this screen sends.
 */
export default function SignUp() {
  const t = useTheme();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordProblem = password.length > 0 ? validatePassword(password) : null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signUp(supabase, { email, password, fullName });
      // Local Supabase auto-confirms; a project requiring email confirmation will
      // reject this and the user is told to check their inbox.
      await signIn(supabase, { email, password });
    } catch (err) {
      const appError = toAppError(err);
      setError(
        appError.code === 'EMAIL_NOT_CONFIRMED'
          ? 'Account created. Check your email to confirm, then sign in.'
          : appError.userMessage,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <View style={{ gap: t.space.xs, marginTop: t.space.xxl }}>
        <Heading level="display">Create account</Heading>
        <Body muted>Order from campus canteens, delivered to your room.</Body>
      </View>

      <View style={{ gap: t.space.lg, marginTop: t.space.xl }}>
        <Field label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" />
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@campus.edu"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          error={passwordProblem?.userMessage}
        />
        <FormError message={error} />
        <Button
          label="Create account"
          onPress={submit}
          loading={busy}
          disabled={fullName.trim().length === 0 || email.length === 0 || passwordProblem !== null}
        />
        <Button
          label="I already have an account"
          variant="secondary"
          onPress={() => router.replace('/sign-in')}
        />
      </View>
    </Screen>
  );
}
