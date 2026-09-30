import { useState } from 'react';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { signUp, validatePassword } from '@canteza/api';
import {
  AppError,
  CAMPUS_EMAIL_DOMAIN,
  ERROR_CODES,
  TEXT_LIMITS,
  isCampusEmail,
  toAppError,
} from '@canteza/shared';
import { supabase } from '../../src/lib/supabase';
import { AuthShell } from '../../src/components/auth-shell';
import { useCaptcha } from '../../src/components/captcha';
import { EmailCodeStep } from '../../src/components/email-code';
import { Button, Field, FormError } from '../../src/components/ui';
import { useTheme } from '../../src/theme';

/**
 * Students only, and only with a college mailbox they can prove (campus_email_signup):
 * one mailbox, one account. Canteen staff and delivery partners are created by an admin,
 * so there is no role picker here to tamper with -- the signup trigger writes
 * `role = 'student'` server-side regardless of what this screen sends.
 *
 * Two steps. The form creates the account and GoTrue emails a code; the code step
 * confirms the address, which signs the student in.
 */
export default function SignUp() {
  const t = useTheme();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [emailLeft, setEmailLeft] = useState(false);
  const captcha = useCaptcha();

  const passwordProblem = password.length > 0 ? validatePassword(password) : null;
  const emailOk = isCampusEmail(email);
  // Said once the student leaves the field, so "you@mnnit.ac" is not called wrong mid-word.
  const emailProblem =
    emailLeft && email.length > 0 && !emailOk
      ? new AppError(ERROR_CODES.EMAIL_NOT_ALLOWED).userMessage
      : undefined;

  async function submit() {
    if (!captcha.ready) return;
    setBusy(true);
    setError(null);
    try {
      // With "Confirm email" on (the launch setting) there is no session until the code
      // is entered. With it off the answer already carries one and the session listener
      // routes the new student in.
      const { signedIn } = await signUp(supabase, {
        email,
        password,
        fullName,
        captchaToken: captcha.token,
      });
      if (!signedIn) setAwaitingCode(true);
    } catch (err) {
      setError(toAppError(err).userMessage);
    } finally {
      setBusy(false);
      captcha.reset();
    }
  }

  const footer = (
    <View style={{ alignItems: 'center', gap: t.space.sm }}>
      <Text style={[t.font.body, { color: t.color.textMuted }]}>Already ordering?</Text>
      <Button
        label="I already have an account"
        variant="secondary"
        onPress={() => router.replace('/sign-in')}
      />
    </View>
  );

  if (awaitingCode) {
    return (
      <AuthShell title="Check your college email" subtitle="One step left." footer={footer}>
        <EmailCodeStep
          email={email.trim().toLowerCase()}
          password={password}
          sent
          onBack={() => setAwaitingCode(false)}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Order from every campus canteen, delivered to your room."
      footer={footer}
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
        label="College email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder={`you@${CAMPUS_EMAIL_DOMAIN}`}
        hint="We'll email a code to it, so use the one you can open."
        error={emailProblem}
        onBlur={() => setEmailLeft(true)}
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
          !emailOk ||
          passwordProblem !== null ||
          !captcha.ready
        }
      />
    </AuthShell>
  );
}
