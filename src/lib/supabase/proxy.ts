import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Paths reachable without a session.
 *
 * Everything else requires one. The platform holds per-learner progress and
 * licensed study material, so an anonymous visitor has nothing legitimate to
 * read; gating here means a new page is private by default rather than public
 * until someone remembers to protect it.
 */
const PUBLIC_PATHS = ["/auth", "/unauthorized", "/manifest.webmanifest"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function updateSession(request: NextRequest) {
  const parsed = getPublicEnv();

  // Without Supabase the application runs as a self-contained demonstration.
  // Redirecting to a sign-in page that cannot authenticate anyone would just
  // produce a dead end, so the gate only applies once auth is available.
  if (!parsed.success) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(
    parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          items.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // A signed-in learner has no use for the sign-in page; send them where they
  // were originally headed, or to the dashboard.
  if (user && pathname === "/auth") {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    url.pathname = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
