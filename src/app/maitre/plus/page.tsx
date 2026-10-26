import Link from "next/link";
import { PageTitle } from "@/components/ui";

export const metadata = { title: "Plus" };

const LINKS = [
  { href: "/maitre/resultats", title: "Résultats détaillés", text: "Bulletins par match, votants, corrections." },
  { href: "/maitre/reglages", title: "Règles et saisons", text: "Malus de retard et de non-vote, saisons." },
  { href: "/maitre/journal", title: "Journal et malus", text: "Opérations administratives et détail des pénalités." },
  { href: "/profil", title: "Mon compte", text: "Mot de passe, déconnexion." },
  { href: "/", title: "Espace joueur", text: "Voter et consulter mon historique." },
];

export default function MorePage() {
  return (
    <div>
      <PageTitle title="Plus" />
      <ul className="divide-y divide-line overflow-hidden rounded-xl bg-chalk">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="block min-h-16 px-4 py-3 hover:bg-pitch-soft">
              <span className="block font-semibold text-pitch">{l.title}</span>
              <span className="block text-sm text-muted">{l.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
