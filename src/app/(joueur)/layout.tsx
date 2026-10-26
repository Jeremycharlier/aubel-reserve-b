import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { BottomNav, type NavItem } from "@/components/nav";

export default async function PlayerLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  const items: NavItem[] = [
    { href: "/", label: "Accueil", icon: "home", exact: true },
    { href: "/calendrier", label: "Calendrier", icon: "calendar" },
    { href: "/historique", label: "Historique", icon: "history" },
    { href: "/profil", label: "Profil", icon: "profile" },
  ];
  if (viewer.role === "maitre") items.push({ href: "/maitre", label: "Maître", icon: "admin" });

  return (
    <div className="pb-nav lg:pb-10">
      <header className="bg-pitch text-chalk">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-display text-xl font-bold">
            Réserve B
          </Link>
          <nav aria-label="Navigation" className="hidden items-center gap-5 text-sm font-semibold lg:flex">
            {items.map((item) => (
              <Link key={item.href} href={item.href} className={item.icon === "admin" ? "text-gold" : "text-chalk/85 hover:text-chalk"}>
                {item.icon === "admin" ? "Espace maître" : item.label}
              </Link>
            ))}
          </nav>
          <span className="text-sm text-chalk/80 lg:hidden">{viewer.displayName}</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 pt-5">{children}</main>
      <BottomNav items={items} />
    </div>
  );
}
