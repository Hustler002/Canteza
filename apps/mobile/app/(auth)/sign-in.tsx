import { useState } from 'react';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { signIn } from '@canteza/api';
import { CAMPUS_EMAIL_DOMAIN, ERROR_CODES, toAppError } from '@canteza/shared';
import { supabase } from '../../src/lib/supabase';
import { AuthShell } from '../../src/components/auth-shell';
import { useCaptcha } from '../../src/components/captcha';
import { EmailCodeStep } from '../../src/components/email-code';
import { Button, Field, FormError } from '../../src/components/ui';
import { useTheme } from '../../src/theme';

export default function SignIn() {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const captcha = useCaptcha();

  async function submit() {
    if (!captcha.ready) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(supabase, { email, password, captchaToken: captcha.token });
      // No navigation here: the session listener re-routes once the role is known.
    } catch (err) {
      const appError = toAppError(err);
      // GoTrue says this only after the password matched: an account that never
      // entered its code. Offer the code step rather than a dead end.
      if (appError.code === ERROR_CODES.EMAIL_NOT_CONFIRMED) setUnconfirmed(true);
      else setError(appError.userMessage);
    } finally {
      setBusy(false);
      // A CAPTCHA token is spent by the attempt, whatever it answered.
      captcha.reset();
    }
  }

  if (unconfirmed) {
    return (
      <AuthShell title="Confirm your email" subtitle="Your account is waiting for its code.">
        <EmailCodeStep
          email={email.trim().toLowerCase()}
          password={password}
          sent={false}
          onBack={() => setUnconfirmed(false)}
          backLabel="Back to sign in"
        />
      </AuthShell>
    );
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
        placeholder={`you@${CAMPUS_EMAIL_DOMAIN}`}
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
      {captcha.element}
      <FormError message={error} />
      <Button
        label="Sign in"
        size="lg"
        onPress={submit}
        loading={busy}
        disabled={email.length === 0 || password.length === 0 || !captcha.ready}
      />
    </AuthShell>
  );
}
