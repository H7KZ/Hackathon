"use client";

import { useQuery } from "@tanstack/react-query";
import { getHealth } from "../lib/api";
import { YoyoSpinner } from "./yoyo-spinner";

export function ApiStatus() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    retry: false,
  });

  if (health.isPending)
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-gray-500">
        <YoyoSpinner size={24} label="Připojuji k API…" />
        API: připojuji…
      </span>
    );
  if (health.isError) return <span className="text-sm text-red-600">API: nedostupné</span>;
  return <span className="text-sm text-green-700 dark:text-green-400">API: v{health.data.version}</span>;
}
