"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ClipboardList,
  History,
  House,
  LayoutDashboard,
  ListOrdered,
  Menu,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cx } from "@/components/ui";

const ICONS: Record<string, LucideIcon> = {
  home: House,
  calendar: CalendarDays,
  history: History,
  profile: UserRound,
  admin: ShieldCheck,
  dashboard: LayoutDashboard,
  ranking: ListOrdered,
  results: ClipboardList,
  team: Users,
  more: Menu,
};

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; exact?: boolean };

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Barre de navigation inférieure (smartphone). */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Navigation principale"
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-chalk/95 backdrop-blur lg:hidden"
    >
      <ul className="mx-auto flex max-w-xl">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex min-h-16 flex-col items-center justify-center gap-0.5 text-[0.72rem] font-semibold",
                  active ? "text-pitch" : "text-muted",
                )}
              >
                <span className={cx("rounded-full px-4 py-1", active && "bg-pitch-soft")}>
                  <Icon size={22} strokeWidth={active ? 2.4 : 2} aria-hidden />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Menu latéral (ordinateur). */
export function SideNav({ items, footer }: { items: NavItem[]; footer?: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigation principale" className="flex flex-1 flex-col">
      <ul className="space-y-1">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex min-h-11 items-center gap-3 rounded-lg px-3 font-semibold",
                  active ? "bg-chalk text-pitch" : "text-chalk/85 hover:bg-pitch-dark",
                )}
              >
                <Icon size={19} aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      {footer ? <div className="mt-auto pt-6">{footer}</div> : null}
    </nav>
  );
}
