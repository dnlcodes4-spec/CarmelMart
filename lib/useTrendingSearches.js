"use client";

import { useQuery } from "@tanstack/react-query";

export const TRENDING_SEARCHES_QUERY_KEY = ["trending-searches"];

async function fetchTrendingSearches() {
  const res = await fetch("/api/search/trending?limit=8");
  if (!res.ok) throw new Error("Failed to load trending searches");
  return res.json();
}

/**
 * Trending search chips, derived from the live catalogue so every suggestion
 * returns results. Mirrors the useCategories() pattern: fetched once, cached
 * for the session.
 *
 * Returns: { suggestions: [{ label, category }], isLoading }
 */
export function useTrendingSearches() {
  const { data, isLoading } = useQuery({
    queryKey: TRENDING_SEARCHES_QUERY_KEY,
    queryFn: fetchTrendingSearches,
    staleTime: 60 * 60 * 1000, // an hour; the API caches for the same window
    refetchOnWindowFocus: false,
  });

  return { suggestions: data?.suggestions ?? [], isLoading };
}
