import { useState } from 'react';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { signIn } from '@canteza/api';
import { toAppError } from '@canteza/shared';
import { supabase } from '../../src/lib/supabase';
import { AuthShell } from '../../src/components/auth-shell';
import { Button, Field, FormError } from '../../src/components/ui';
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
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to order, track and pay."
      footer={
        <View style={{ alignItems: 'center', gap: t.space.sm }}>
          <Text style={[t.font.body, { color: t.color.textMuted }]}>New to campus delivery?</Text>
          <Link href="/sign-up" asChild>
            <Button label="Create a student account" variant="secondary" onPress={() => {}} />
          </Link>
        </View>
      }
    >
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
        size="lg"
        onPress={submit}
        loading={busy}
        disabled={email.length === 0 || password.length === 0}
      />
    </AuthShell>
  );
}
