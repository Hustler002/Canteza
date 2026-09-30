import { describe, expect, it } from 'vitest';
import {
  normaliseEmail,
  resendSignUpCode,
  signIn,
  signUp,
  validatePassword,
  verifySignUpCode,
} from '../src/auth';
import { mapSupabaseError } from '../src/errors';
import type { CampusClient } from '../src/client';
import { createCampusClient } from '../src/client';

describe('validatePassword', () => {
  it('accepts a reasonable password', () => {
    expect(validatePassword('hostel2026')).toBeNull();
  });

  it('rejects short, letter-only or digit-only passwords before the round trip', () => {
    expect(validatePassword('abc1')?.code).toBe('WEAK_PASSWORD');
    expect(validatePassword('allletters')?.code).toBe('WEAK_PASSWORD');
    expect(validatePassword('12345678')?.code).toBe('WEAK_PASSWORD');
  });
});

describe('normaliseEmail', () => {
  it('trims and lowercases, so Riya@Campus.edu signs in as riya@campus.edu', () => {
    expect(normaliseEmail('  Riya@Campus.edu ')).toBe('riya@campus.edu');
  });
});

describe('createCampusClient', () => {
  it('refuses to start without credentials rather than failing later at a query', () => {
    expect(() => createCampusClient({ url: '', anonKey: '' })).toThrow(/required/i);
  });

  it('refuses a service role key, which must never reach an app bundle', () => {
    expect(() =>
      createCampusClient({
        url: 'https://x.supabase.co',
        anonKey: `header.${'service_role'.padEnd(80, 'x')}.sig`,
      }),
    ).toThrow(/service role/i);
  });

  it('refuses the newer sb_secret_ key, which says nothing about its own role', () => {
    expect(() =>
      createCampusClient({
        url: 'https://x.supabase.co',
        anonKey: 'sb_secret_test_fixture',
      }),
    ).toThrow(/service role/i);
  });

  it('accepts the newer sb_publishable_ key, which is the one that belongs in a bundle', () => {
    expect(() =>
      createCampusClient({
        url: 'https://x.supabase.co',
        anonKey: 'sb_publishable_6wHsAIUHgVyOfifNqyBNWQ_YipbMxwV',
      }),
    ).not.toThrow();
  });
});

describe('CAPTCHA tokens', () => {
  type Call = Record<string, unknown>;
  const stub = (session: object | null = null) => {
    const calls: { signIn: Call[]; signUp: Call[] } = { signIn: [], signUp: [] };
    const client = {
      auth: {
        signInWithPassword: async (args: Call) => {
          calls.signIn.push(args);
          return { data: {}, error: null };
        },
        signUp: async (args: Call) => {
          calls.signUp.push(args);
          return { data: { session }, error: null };
        },
      },
    } as unknown as CampusClient;
    return { client, calls };
  };

  it('hands the token to GoTrue on sign-in, and sends no options without one', async () => {
    const { client, calls } = stub();
    await signIn(client, { email: 'a@b.c', password: 'hostel2026', captchaToken: 'tok' });
    await signIn(client, { email: 'a@b.c', password: 'hostel2026' });
    expect(calls.signIn[0]).toMatchObject({ options: { captchaToken: 'tok' } });
    expect(calls.signIn[1]).not.toHaveProperty('options');
  });

  it('hands the token to GoTrue on sign-up, beside the name', async () => {
    const { client, calls } = stub();
    await signUp(client, {
      email: 'riya.2023@mnnit.ac.in',
      password: 'hostel2026',
      fullName: ' Riya ',
      captchaToken: 'tok',
    });
    expect(calls.signUp[0]).toMatchObject({
      options: { data: { full_name: 'Riya' }, captchaToken: 'tok' },
    });
  });

  it('reports whether sign-up already signed the student in', async () => {
    const withSession = stub({ access_token: 'x' });
    const without = stub(null);
    const input = { email: 'riya.2023@mnnit.ac.in', password: 'hostel2026', fullName: 'Riya' };
    expect(await signUp(withSession.client, input)).toEqual({ signedIn: true });
    expect(await signUp(without.client, input)).toEqual({ signedIn: false });
  });

  it('turns a refused token into CAPTCHA_FAILED', () => {
    expect(
      mapSupabaseError({ message: 'captcha protection: request disallowed (no captcha response)' })
        .code,
    ).toBe('CAPTCHA_FAILED');
  });
});

describe('sign-up by college email and code', () => {
  type Call = Record<string, unknown>;
  const stub = (answers: { verify?: object | null; update?: object | null } = {}) => {
    const calls: Record<'signUp' | 'verifyOtp' | 'updateUser' | 'resend', Call[]> = {
      signUp: [],
      verifyOtp: [],
      updateUser: [],
      resend: [],
    };
    const record =
      (name: keyof typeof calls, error: object | null = null) =>
      async (args: Call) => {
        calls[name].push(args);
        return { data: { session: null }, error };
      };
    const client = {
      auth: {
        signUp: record('signUp'),
        verifyOtp: record('verifyOtp', answers.verify ?? null),
        updateUser: record('updateUser', answers.update ?? null),
        resend: record('resend'),
      },
    } as unknown as CampusClient;
    return { client, calls };
  };
  const input = { password: 'hostel2026', fullName: 'Riya' };

  it('refuses any other address before asking GoTrue, so no CAPTCHA token is spent', async () => {
    const { client, calls } = stub();
    for (const email of ['riya@gmail.com', 'riya+2@mnnit.ac.in', 'riya@cse.mnnit.ac.in']) {
      await expect(signUp(client, { ...input, email })).rejects.toMatchObject({
        code: 'EMAIL_NOT_ALLOWED',
      });
    }
    expect(calls.signUp).toHaveLength(0);
  });

  it('accepts the college address in any case, and sends it lower-cased', async () => {
    const { client, calls } = stub();
    await signUp(client, { ...input, email: ' Riya.2023@MNNIT.ac.in ' });
    expect(calls.signUp[0]).toMatchObject({ email: 'riya.2023@mnnit.ac.in' });
  });

  it('verifies the code as a sign-up confirmation, then makes the typed password the one', async () => {
    const { client, calls } = stub();
    await verifySignUpCode(client, {
      email: 'Riya.2023@mnnit.ac.in',
      code: '123 456',
      password: 'hostel2026',
    });
    expect(calls.verifyOtp[0]).toEqual({
      email: 'riya.2023@mnnit.ac.in',
      token: '123456',
      type: 'signup',
    });
    expect(calls.updateUser[0]).toEqual({ password: 'hostel2026' });
  });

  it('treats "that is already the password" as success', async () => {
    const { client } = stub({
      update: { code: 'same_password', message: 'New password should be different' },
    });
    await expect(
      verifySignUpCode(client, { email: 'r@mnnit.ac.in', code: '1', password: 'hostel2026' }),
    ).resolves.toBeUndefined();
  });

  it('turns a wrong or expired code into CODE_INVALID, and never sets a password', async () => {
    const { client, calls } = stub({
      verify: { code: 'otp_expired', message: 'Token has expired or is invalid' },
    });
    await expect(
      verifySignUpCode(client, { email: 'r@mnnit.ac.in', code: '000000', password: 'hostel2026' }),
    ).rejects.toMatchObject({ code: 'CODE_INVALID' });
    expect(calls.updateUser).toHaveLength(0);
  });

  it('sends a new code with a CAPTCHA token, since GoTrue guards /resend with it', async () => {
    const { client, calls } = stub();
    await resendSignUpCode(client, { email: 'R@mnnit.ac.in', captchaToken: 'tok' });
    expect(calls.resend[0]).toEqual({
      type: 'signup',
      email: 'r@mnnit.ac.in',
      options: { captchaToken: 'tok' },
    });
  });

  it("maps the sign-up hook's refusal to EMAIL_NOT_ALLOWED", () => {
    expect(
      mapSupabaseError({ message: 'EMAIL_NOT_ALLOWED: sign up with a college email' }).code,
    ).toBe('EMAIL_NOT_ALLOWED');
  });
});
