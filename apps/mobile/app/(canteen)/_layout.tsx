import { SignedInStack } from '../../src/components/SignedInStack';

/** See SignedInStack: renders nothing once signed out, so no screen outlives its identity. */
export default function RoleLayout() {
  return <SignedInStack />;
}
