export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-3 px-4 pt-6" aria-busy="true" aria-label="Chargement">
      <div className="h-9 w-2/3 animate-pulse rounded-lg bg-line/70" />
      <div className="h-28 animate-pulse rounded-xl bg-chalk" />
      <div className="h-28 animate-pulse rounded-xl bg-chalk" />
    </div>
  );
}
