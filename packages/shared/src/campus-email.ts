/**
 * Who may create a student account: someone holding a college mailbox, proven by a
 * code sent to it. One mailbox, one account — which is the point: without it one student
 * could open as many accounts as they have throwaway addresses, each with its own five
 * open orders and its own first-order coupon.
 *
 * The authoritative copy is `public.is_campus_email()` in the campus_email_signup
 * migration, which the Supabase "Before User Created" hook calls on every sign-up.
 * This copy tells the student before the round trip; `campus-email.test.ts` fails if
 * the two ever disagree.
 *
 * Staff are not students: canteen workers and delivery partners are created by an admin
 * (dashboard "Add user" or the admin API), which the hook does not see.
 */
export const CAMPUS_EMAIL_DOMAIN = 'mnnit.ac.in';

/**
 * A mailbox at exactly the campus domain, with no `+tag`. The college mail is Google
 * Workspace (its MX records are `ASPMX.L.GOOGLE.COM` and friends, checked 2026-09-30), where `name+1@` and `name+2@` both land in `name@` — so a tagged address
 * would be a second account on the same mailbox. Letters, digits, dots, `_` and `-`
 * cover every real address; anything else is refused rather than guessed at.
 * Subdomains (`x@cse.mnnit.ac.in`) are not the college mailbox and are refused too.
 */
const CAMPUS_EMAIL = /^[a-z0-9._-]+@mnnit\.ac\.in$/;

export function isCampusEmail(email: string): boolean {
  return CAMPUS_EMAIL.test(email.trim().toLowerCase());
}
