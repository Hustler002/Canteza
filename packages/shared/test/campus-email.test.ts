import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAMPUS_EMAIL_DOMAIN, isCampusEmail } from '../src/campus-email';
import { AppError } from '../src/errors';

/**
 * The form's copy of the sign-up rule. The database's copy is tested against it in
 * supabase/test/campus-email.test.ts; this pins the domain in the one place that writes
 * it as a literal twice.
 */
describe('isCampusEmail', () => {
  it('knows the college by its domain', () => {
    expect(isCampusEmail(`name@${CAMPUS_EMAIL_DOMAIN}`)).toBe(true);
    expect(isCampusEmail('name@gmail.com')).toBe(false);
  });

  it('names the same domain as the migration', () => {
    const sql = readFileSync(
      fileURLToPath(
        new URL(
          '../../../supabase/migrations/20260930120000_campus_email_signup.sql',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    expect(sql).toContain(`@${CAMPUS_EMAIL_DOMAIN.replace(/\./g, '\\.')}$`);
    expect(sql).toContain(`(@${CAMPUS_EMAIL_DOMAIN})`);
  });

  it('tells a student which address to use', () => {
    expect(new AppError('EMAIL_NOT_ALLOWED').userMessage).toContain(`@${CAMPUS_EMAIL_DOMAIN}`);
  });
});
