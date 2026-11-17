import Link from "next/link";
import { requireStaff, ROLE_TITLE } from "@/lib/auth";
import { BottomNav, SideNav, type NavItem } from "@/components/nav";

// Espace de gestion : administrateur (tout) et entraîneur (matchs uniquement).
export default async function GestionLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireStaff();
  const isAdmin = viewer.role === "maitre";
  const title = isAdmin ? "Administration" : "Espace entraîneur";

  const desktop: NavItem[] = isAdmin
    ? [
        { href: "/gestion", label: "Tableau de bord", icon: "dashboard", exact: true },
        { href: "/gestion/matchs", label: "Calendrier et matchs", icon: "calendar" },
        { href: "/gestion/classement", label: "Classement", icon: "ranking" },
        { href: "/gestion/resultats", label: "Résultats détaillés", icon: "results" },
        { href: "/gestion/equipe", label: "Équipe et comptes", icon: "team" },
        { href: "/gestion/notifications", label: "Notifications", icon: "bell" },
        { href: "/gestion/reglages", label: "Règles et saisons", icon: "admin" },
        { href: "/gestion/journal", label: "Journal et malus", icon: "history" },
      ]
    : [
        { href: "/gestion", label: "Tableau de bord", icon: "dashboard", exact: true },
        { href: "/gestion/matchs", label: "Calendrier et matchs", icon: "calendar" },
      ];
  const mobile: NavItem[] = isAdmin
    ? [
        { href: "/gestion", label: "Tableau", icon: "dashboard", exact: true },
        { href: "/gestion/matchs", label: "Matchs", icon: "calendar" },
        { href: "/gestion/classement", label: "Classement", icon: "ranking" },
        { href: "/gestion/equipe", label: "Équipe", icon: "team" },
        { href: "/gestion/plus", label: "Plus", icon: "more" },
      ]
    : [
        { href: "/gestion", label: "Tableau", icon: "dashboard", exact: true },
        { href: "/gestion/matchs", label: "Matchs", icon: "calendar" },
        { href: "/", label: "Espace joueur", icon: "home", exact: true },
      ];

  return (
    <div className="lg:flex">
      <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto bg-pitch px-4 py-6 text-chalk lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <Link href="/gestion" className="mb-8 block px-3">
          <span className="block font-display text-sm font-semibold text-gold">{title}</span>
          <span className="block font-display text-3xl font-bold leading-none">Réserve B</span>
        </Link>
        <SideNav
          items={desktop}
          footer={
            <div className="space-y-2 px-3 text-sm">
              <p className="text-chalk/70">
                {viewer.displayName}, {ROLE_TITLE[viewer.role].toLowerCase()}
              </p>
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
            <Link href="/gestion" className="font-display text-xl font-bold">
              Réserve B <span className="text-gold">{isAdmin ? "admin" : "entraîneur"}</span>
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
