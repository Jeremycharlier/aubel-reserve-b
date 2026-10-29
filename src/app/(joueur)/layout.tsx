import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { BottomNav, type NavItem } from "@/components/nav";

export default async function PlayerLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  const items: NavItem[] = [
    { href: "/", label: "Accueil", icon: "home", exact: true },
    { href: "/calendrier", label: "Calendrier", icon: "calendar" },
    { href: "/joueurs", label: "Joueurs", icon: "team" },
    { href: "/historique", label: "Historique", icon: "history" },
    { href: "/profil", label: "Profil", icon: "profile" },
  ];
  const isMaitre = viewer.role === "maitre";

  return (
    <div className="pb-nav lg:pb-10">
      <header className="bg-pitch text-chalk">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-display text-xl font-bold">
            Réserve B
          </Link>
          <nav aria-label="Navigation" className="hidden items-center gap-5 text-sm font-semibold lg:flex">
            {items.map((item) => (
              <Link key={item.href} href={item.href} className="text-chalk/85 hover:text-chalk">
                {item.label}
              </Link>
            ))}
            {isMaitre ? (
              <Link href="/maitre" className="text-gold">
                Espace maître
              </Link>
            ) : null}
          </nav>
          {isMaitre ? (
            <Link href="/maitre" className="text-sm font-semibold text-gold lg:hidden">
              Espace maître
            </Link>
          ) : (
            <span className="text-sm text-chalk/80 lg:hidden">{viewer.displayName}</span>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 pt-5">{children}</main>
      <BottomNav items={items} />
    </div>
  );
}
