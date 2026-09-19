import { Redirect } from 'expo-router';
import { ROLE_HOME } from '@campuseats/shared';
import { useSession } from '../src/lib/session';
import { Loading } from '../src/components/ui';

/** Entry point: send people wherever their role belongs. */
export default function Index() {
  const { loading, identity } = useSession();
  if (loading) return <Loading />;
  if (!identity) return <Redirect href="/sign-in" />;
  return <Redirect href={ROLE_HOME[identity.role] as never} />;
}
