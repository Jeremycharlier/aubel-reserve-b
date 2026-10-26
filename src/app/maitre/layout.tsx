import Link from "next/link";
import { requireMaitre } from "@/lib/auth";
import { BottomNav, SideNav, type NavItem } from "@/components/nav";

export default async function MaitreLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireMaitre();
  const desktop: NavItem[] = [
    { href: "/maitre", label: "Tableau de bord", icon: "dashboard", exact: true },
    { href: "/maitre/matchs", label: "Calendrier et matchs", icon: "calendar" },
    { href: "/maitre/classement", label: "Classement", icon: "ranking" },
    { href: "/maitre/resultats", label: "Résultats détaillés", icon: "results" },
    { href: "/maitre/equipe", label: "Équipe et comptes", icon: "team" },
    { href: "/maitre/reglages", label: "Règles et saisons", icon: "admin" },
    { href: "/maitre/journal", label: "Journal et malus", icon: "history" },
  ];
  const mobile: NavItem[] = [
    { href: "/maitre", label: "Tableau", icon: "dashboard", exact: true },
    { href: "/maitre/matchs", label: "Matchs", icon: "calendar" },
    { href: "/maitre/classement", label: "Classement", icon: "ranking" },
    { href: "/maitre/equipe", label: "Équipe", icon: "team" },
    { href: "/maitre/plus", label: "Plus", icon: "more" },
  ];

  return (
    <div className="lg:flex">
      <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto bg-pitch px-4 py-6 text-chalk lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <Link href="/maitre" className="mb-8 block px-3">
          <span className="block font-display text-sm font-semibold text-gold">Espace maître</span>
          <span className="block font-display text-3xl font-bold leading-none">Réserve B</span>
        </Link>
        <SideNav
          items={desktop}
          footer={
            <div className="space-y-2 px-3 text-sm">
              <p className="text-chalk/70">Connecté : {viewer.displayName}</p>
              <Link href="/" className="font-semibold text-gold">
                Espace joueur (voter)
              </Link>
            </div>
          }
        />
      </aside>
      <div className="min-w-0 flex-1">
        <header className="bg-pitch text-chalk lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <Link href="/maitre" className="font-display text-xl font-bold">
              Réserve B <span className="text-gold">maître</span>
            </Link>
            <Link href="/" className="text-sm font-semibold text-chalk/85">
              Espace joueur
            </Link>
          </div>
        </header>
        <main className="pb-nav mx-auto max-w-5xl px-4 pt-5 lg:px-8 lg:pb-12 lg:pt-8">{children}</main>
      </div>
      <BottomNav items={mobile} />
    </div>
  );
}
