import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the session on every request and guards the dashboard.
 *
 * Next 16 calls this file `proxy.ts` (it was `middleware.ts` before).
 *
 * `getClaims()` verifies the token signature; `getSession()` only reads the cookie
 * and would trust whatever a browser sent. Never use the latter here.
 *
 * This is a redirect, not the security boundary: RLS is. A non-admin who reaches a
 * page anyway sees an empty dashboard, because the database returns them nothing.
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const isLoginPage = request.nextUrl.pathname.startsWith('/login');

  if (!signedIn && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  if (signedIn && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  // Must be the response `setAll` last built: an earlier one does not carry the
  // refreshed cookies, and the user is signed out on the next request.
  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*[.](?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
