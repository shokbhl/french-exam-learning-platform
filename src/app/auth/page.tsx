import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Read the intended destination on the server so the form can carry it
  // through sign-in without the client having to inspect the URL.
  const { next } = await searchParams;
  const target = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <main className="auth-page">
      <Link href="/" className="brand auth-brand">
        <span className="brand-mark">ç</span><span>Parcours<span>français</span></span>
      </Link>
      <AuthForm next={target} />
    </main>
  );
}
