import { redirect } from "next/navigation";

/**
 * /search was a second, weaker search page: nothing linked to it, it carried
 * fewer filters than /shop, and it defaulted to sort=newest so it could never
 * rank by relevance. It now redirects, preserving query params — /shop reads
 * the same names (q, category, min_price, max_price, min_rating, sort, page).
 */
export default async function SearchRedirect({ searchParams }) {
  const sp = (await searchParams) ?? {};

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else params.set(key, value);
  }

  const qs = params.toString();
  redirect(qs ? `/shop?${qs}` : "/shop");
}
