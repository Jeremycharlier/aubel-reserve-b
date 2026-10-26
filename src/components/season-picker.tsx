"use client";

import { useRouter } from "next/navigation";

export function SeasonPicker({
  seasons,
  current,
  basePath,
}: {
  seasons: { id: string; name: string; is_current: boolean }[];
  current: string;
  basePath: string;
}) {
  const router = useRouter();
  if (seasons.length <= 1) {
    return <span>Saison {seasons[0]?.name}</span>;
  }
  return (
    <label className="inline-flex items-center gap-2">
      <span>Saison</span>
      <select
        className="min-h-10 rounded-lg border border-line bg-white px-2 font-semibold text-ink"
        value={current}
        onChange={(e) => router.push(`${basePath}?saison=${e.target.value}`)}
      >
        {seasons.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.is_current ? " (en cours)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
