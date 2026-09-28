/**
 * Kept apart from `session.tsx`, which loads React Native and Supabase at import, so the
 * wording can be tested in Node. Used by `useConfirmSignOut`.
 */

/** What signing out costs this person, for the role actually signed in. */
export function signOutConsequence(role: string | undefined, cartLines: number): string {
  switch (role) {
    case 'canteen':
      return 'This phone will stop getting new-order alerts for your counter.';
    case 'delivery':
      // is_online lives in the database, not the session, so signing out leaves it as it
      // was. Saying so stops a partner assuming the app took them off shift.
      return 'This phone will stop getting delivery alerts. Signing out does not end your shift — go offline first if you are finishing.';
    default:
      return cartLines > 0
        ? 'Your cart will be emptied and this phone will stop getting your order updates.'
        : 'This phone will stop getting your order updates.';
  }
}
