import { describe, expect, it } from 'vitest';
import { normaliseEmail, validatePassword } from '../src/auth';
import { createCampusClient } from '../src/client';

describe('validatePassword', () => {
  it('accepts a reasonable password', () => {
    expect(validatePassword('campus1234')).toBeNull();
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
});
