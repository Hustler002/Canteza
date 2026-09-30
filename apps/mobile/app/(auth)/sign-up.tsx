import { useState } from 'react';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { signUp, validatePassword } from '@canteza/api';
import { TEXT_LIMITS, toAppError } from '@canteza/shared';
import { supabase } from '../../src/lib/supabase';
import { AuthShell } from '../../src/components/auth-shell';
import { useCaptcha } from '../../src/components/captcha';
import { Button, Field, FormError } from '../../src/components/ui';
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
  const captcha = useCaptcha();

  const passwordProblem = password.length > 0 ? validatePassword(password) : null;

  async function submit() {
    if (!captcha.ready) return;
    setBusy(true);
    setError(null);
    try {
      // With "Confirm email" off the answer already carries a session and the session
      // listener routes the new student in; there is no second sign-in, which would
      // need a second CAPTCHA token. With it on there is no session yet.
      const { signedIn } = await signUp(supabase, {
        email,
        password,
        fullName,
        captchaToken: captcha.token,
      });
      if (!signedIn) setError('Account created. Check your email to confirm, then sign in.');
    } catch (err) {
      const appError = toAppError(err);
      setError(
        appError.code === 'EMAIL_NOT_CONFIRMED'
          ? 'Account created. Check your email to confirm, then sign in.'
          : appError.userMessage,
      );
    } finally {
      setBusy(false);
      captcha.reset();
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Order from every campus canteen, delivered to your room."
      footer={
        <View style={{ alignItems: 'center', gap: t.space.sm }}>
          <Text style={[t.font.body, { color: t.color.textMuted }]}>Already ordering?</Text>
          <Button
            label="I already have an account"
            variant="secondary"
            onPress={() => router.replace('/sign-in')}
          />
        </View>
      }
    >
      <Field
        label="Full name"
        value={fullName}
        onChangeText={setFullName}
        autoComplete="name"
        placeholder="Riya Sharma"
        maxLength={TEXT_LIMITS.fullName}
      />
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
      {captcha.element}
      <FormError message={error} />
      <Button
        label="Create account"
        size="lg"
        onPress={submit}
        loading={busy}
        disabled={
          fullName.trim().length === 0 ||
          email.length === 0 ||
          passwordProblem !== null ||
          !captcha.ready
        }
      />
    </AuthShell>
  );
}
