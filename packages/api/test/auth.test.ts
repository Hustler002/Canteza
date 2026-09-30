import { describe, expect, it } from 'vitest';
import { normaliseEmail, signIn, signUp, validatePassword } from '../src/auth';
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
      email: 'a@b.c',
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
    const input = { email: 'a@b.c', password: 'hostel2026', fullName: 'Riya' };
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
