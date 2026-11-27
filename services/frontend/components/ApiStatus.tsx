"use client";

import { useQuery } from "@tanstack/react-query";
import { getHealth } from "../lib/api";

export function ApiStatus() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    retry: false,
  });

  if (health.isPending) return <span className="text-sm text-gray-500">API: připojuji…</span>;
  if (health.isError) return <span className="text-sm text-red-600">API: nedostupné</span>;
  return <span className="text-sm text-green-700 dark:text-green-400">API: v{health.data.version}</span>;
}
