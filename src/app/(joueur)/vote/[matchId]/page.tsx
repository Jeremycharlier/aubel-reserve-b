import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { getMatch, getMyBallots } from "@/lib/data";
import { fmtDateTime, fmtPrecise } from "@/lib/time";
import { EmptyState, Panel, Tag } from "@/components/ui";
import { MatchHeading } from "@/components/match-line";
import { VoteForm, type Teammate } from "./vote-form";

export const metadata = { title: "Vote" };

export default async function VotePage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const viewer = await requireViewer();
  const supabase = await createUserClient();
  const match = await getMatch(supabase, matchId);
  if (!match || !viewer.playerId) notFound();

  const [{ data: sheet }, ballots] = await Promise.all([
    supabase
      .from("match_players")
      .select("player_id, players(id, display_name, shirt_number)")
      .eq("match_id", match.id),
    getMyBallots(supabase, viewer.playerId),
  ]);
  const inSquad = (sheet ?? []).some((r) => r.player_id === viewer.playerId);
  const ballot = ballots.get(match.id);
  const teammates: Teammate[] = (sheet ?? [])
    .map((r) => r.players as unknown as { id: string; display_name: string; shirt_number: number | null })
    .filter((p) => p && p.id !== viewer.playerId)
    .map((p) => ({ id: p.id, name: p.display_name, number: p.shirt_number }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const back = (
    <Link href="/" className="mb-4 inline-flex min-h-11 items-center text-sm font-semibold text-pitch">
      ← Retour
    </Link>
  );

  if (!inSquad) {
    return (
      <div>
        {back}
        <EmptyState title="Vous n'êtes pas sur la feuille de match">
          Seuls les joueurs présents pour ce match peuvent voter. Si c&apos;est une erreur, prévenez le maître.
        </EmptyState>
      </div>
    );
  }

  if (match.effective_state !== "ouvert") {
    const names = new Map(teammates.map((t) => [t.id, t.name]));
    return (
      <div className="space-y-4">
        {back}
        <Panel>
          <MatchHeading match={match} />
        </Panel>
        <EmptyState title={match.effective_state === "ferme" ? "Le vote est fermé" : "Le vote n'est pas encore ouvert"}>
          {match.effective_state === "a_venir" && match.vote_opens_at
            ? `Ouverture prévue : ${fmtDateTime(match.vote_opens_at)}.`
            : match.effective_state === "ferme"
              ? "Les bulletins ne peuvent plus être modifiés."
              : "Le maître l'ouvrira après le match."}
        </EmptyState>
        {ballot ? (
          <Panel>
            <p className="font-semibold">Votre bulletin</p>
            <ol className="mt-2 space-y-1">
              {ballot.ballot_selections.map((s) => (
                <li key={s.rank} className="num">
                  {s.rank}. {names.get(s.selected_player_id) ?? "Joueur"} : {s.points} pt{s.points > 1 ? "s" : ""}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-sm text-muted">Envoyé le {fmtPrecise(ballot.first_submitted_at)}</p>
          </Panel>
        ) : null}
      </div>
    );
  }

  const deadlinePassed = new Date(match.vote_deadline) < new Date();

  return (
    <div className="space-y-4">
      {back}
      <Panel>
        <MatchHeading match={match} />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span>
            Heure limite : <strong>{fmtDateTime(match.vote_deadline)}</strong>
          </span>
          {match.vote_closes_at ? <span className="text-muted">Fermeture : {fmtDateTime(match.vote_closes_at)}</span> : null}
          {ballot ? (
            ballot.is_late ? <Tag tone="late">Votre bulletin est en retard</Tag> : <Tag tone="ok">Votre bulletin est à temps</Tag>
          ) : null}
        </div>
        {!ballot && deadlinePassed ? (
          <p className="mt-3 rounded-lg bg-late-soft px-3 py-2 text-sm font-semibold text-late">
            L&apos;heure limite est dépassée : votre bulletin sera enregistré en retard et un malus pourra s&apos;appliquer.
          </p>
        ) : null}
      </Panel>
      {teammates.length < 3 ? (
        <EmptyState title="Feuille de match incomplète">Il faut au moins trois coéquipiers sur la feuille pour voter.</EmptyState>
      ) : (
        <VoteForm
          matchId={match.id}
          teammates={teammates}
          initial={ballot?.status === "valide" ? ballot.ballot_selections.map((s) => s.selected_player_id) : []}
          alreadyVoted={!!ballot}
        />
      )}
    </div>
  );
}
