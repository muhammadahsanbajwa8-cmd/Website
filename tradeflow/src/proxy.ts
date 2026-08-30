import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the Supabase session cookie on every request, and keeps signed-out
 * visitors out of the application shell.
 *
 * This is a redirect, not a security control: the pages behind it re-check the
 * session server-side and every query is filtered by row level security. It
 * exists so a logged-out user lands on the sign-in page instead of an empty
 * dashboard.
 */

const PUBLIC_PREFIXES = [
  '/', '/pricing', '/login', '/signup', '/forgot-password', '/reset-password',
  '/verify', '/auth', '/q/', '/i/', '/invite', '/api/health',
];

function isPublic(pathname: string): boolean {
  if (pathname === '/' || pathname === '/pricing') return true;
  return PUBLIC_PREFIXES.some((prefix) =>
    prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Without Supabase configured the app renders its setup page rather than
  // crashing in middleware, which would show a blank 500 with no explanation.
  if (!url || !key || url.includes('YOUR-PROJECT')) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/login';
    redirect.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(redirect);
  }

  // A signed-in user has no use for the sign-in page.
  if (user && (pathname === '/login' || pathname === '/signup')) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/dashboard';
    redirect.search = '';
    return NextResponse.redirect(redirect);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next's own assets and image files.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
