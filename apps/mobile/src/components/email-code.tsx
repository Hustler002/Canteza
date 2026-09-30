import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { resendSignUpCode, verifySignUpCode } from '@canteza/api';
import { toAppError } from '@canteza/shared';
import { supabase } from '../lib/supabase';
import { useCaptcha } from './captcha';
import { Button, Field, FormError } from './ui';
import { useTheme } from '../theme';

/** GoTrue sends at most one email per address a minute; the button waits the same. */
const RESEND_SECONDS = 60;

/**
 * The second half of signing up: the code from the email. Entering it confirms the
 * address and signs the student in, and the session listener routes them on -- nothing
 * here navigates.
 *
 * Used by sign-up (a code was just sent) and by sign-in, when the password was right but
 * the address was never confirmed (no code sent yet, or it has expired). The password
 * comes along because verifying sets it: see `verifySignUpCode`.
 *
 * The CAPTCHA is only for sending a code (`/resend` is guarded; `/verify` is not), so the
 * widget mounts only once the button can be used, and a token cannot expire while the
 * countdown runs.
 */
export function EmailCodeStep({
  email,
  password,
  sent,
  onBack,
  backLabel = 'Use a different email',
}: {
  email: string;
  password: string;
  /** Whether a code went out just now, which starts the countdown. */
  sent: boolean;
  onBack: () => void;
  backLabel?: string;
}) {
  const t = useTheme();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(sent ? `We sent a code to ${email}.` : null);
  const [wait, setWait] = useState(sent ? RESEND_SECONDS : 0);
  const captcha = useCaptcha();

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const digits = code.replace(/\s+/g, '');
  // GoTrue's code is 6 digits unless the project sets a longer one (up to 10).
  const complete = /^\d{6,10}$/.test(digits);

  async function verify() {
    if (!complete) return;
    setBusy(true);
    setError(null);
    try {
      await verifySignUpCode(supabase, { email, code: digits, password });
    } catch (err) {
      setError(toAppError(err).userMessage);
      setBusy(false);
    }
    // On success stay busy: the session listener is about to replace this screen.
  }

  async function send() {
    if (!captcha.ready) return;
    setSending(true);
    setError(null);
    try {
      await resendSignUpCode(supabase, { email, captchaToken: captcha.token });
      setNotice(`We sent a new code to ${email}.`);
      setCode('');
      setWait(RESEND_SECONDS);
    } catch (err) {
      setError(toAppError(err).userMessage);
    } finally {
      setSending(false);
      captcha.reset();
    }
  }

  return (
    <View style={{ gap: t.space.lg }}>
      <Text style={[t.font.body, { color: t.color.textMuted }]}>
        {notice ?? `Confirm ${email} to finish. Send a code, then enter it here.`} It can take a
        minute to arrive; check spam too.
      </Text>
      <Field
        label="Code from the email"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        placeholder="123456"
        maxLength={12}
        onSubmitEditing={verify}
        returnKeyType="go"
      />
      <FormError message={error} />
      <Button
        label="Verify and continue"
        size="lg"
        onPress={verify}
        loading={busy}
        disabled={!complete}
      />

      <View style={{ gap: t.space.sm }}>
        {wait > 0 ? null : captcha.element}
        <Button
          label={
            wait > 0 ? `Send a new code in ${wait}s` : notice ? 'Send a new code' : 'Send me a code'
          }
          variant="secondary"
          onPress={send}
          loading={sending}
          disabled={wait > 0 || !captcha.ready}
        />
        <Button label={backLabel} variant="ghost" onPress={onBack} />
      </View>
    </View>
  );
}
