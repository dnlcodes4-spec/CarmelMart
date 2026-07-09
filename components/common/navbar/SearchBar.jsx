"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Search, X, MapPin, ChevronDown, RotateCcw } from "lucide-react";
import Image from "next/image";
import { NIGERIAN_STATES } from "./navbar.data";

// ─── Highlight matching text in suggestions ───────────────────────────────────

function HighlightMatch({ text, query }) {
  if (!query || query.length < 2) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-transparent font-black text-gray-900 not-italic">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ─── Suggestions dropdown (shared between desktop + mobile) ──────────────────

export function SuggestionsDropdown({
  searchQuery, debouncedQuery, searchCategory,
  liveResults, liveLoading, filteredSuggestions,
  trendingSuggestions = [],
  activeIndex, setActiveIndex,
  recentSearches, clearRecentSearches,
  onSuggestionClick, onProductClick, onSubmitAll,
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.15 }}
      className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50"
    >
      {/* Live product results */}
      {debouncedQuery.length >= 2 && (
        <>
          <div className="px-4 py-2.5 border-b border-gray-50 flex items-center justify-between">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              {liveLoading ? "Searching…" : liveResults.length > 0 ? `${liveResults.length} products` : "No products found"}
            </p>
            {searchCategory !== "All Categories" && (
              <span className="text-[11px] text-primary font-medium bg-primary/5 px-2 py-0.5 rounded-full">
                in {searchCategory}
              </span>
            )}
          </div>

          {liveLoading && (
            <div className="px-4 py-3 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="w-10 h-10 bg-gray-100 rounded-xl shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-gray-100 rounded w-3/4" />
                    <div className="h-2.5 bg-gray-100 rounded w-1/3" />
                  </div>
                  <div className="h-4 bg-gray-100 rounded w-16 shrink-0" />
                </div>
              ))}
            </div>
          )}

          {!liveLoading && liveResults.length > 0 && (
            <div className="max-h-72 overflow-y-auto">
              {liveResults.map((product, idx) => {
                const image    = Array.isArray(product.images) ? product.images[0] : product.image;
                const price    = product.salePrice ?? product.price;
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={product.id}
                    type="button"
                    onMouseDown={() => onProductClick(product)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left ${isActive ? "bg-primary/5" : "hover:bg-gray-50"}`}
                  >
                    <div className="relative w-10 h-10 rounded-xl overflow-hidden bg-gray-100 shrink-0 border border-gray-100">
                      {image && <Image src={image} alt={product.name} fill className="object-cover" sizes="40px" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 font-medium truncate">
                        <HighlightMatch text={product.name} query={debouncedQuery} />
                      </p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {product.vendor?.name ?? product.category?.name}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-gray-900">₦{price.toLocaleString()}</p>
                      {product.salePrice && (
                        <p className="text-[10px] text-gray-400 line-through">₦{product.price.toLocaleString()}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {!liveLoading && liveResults.length === 0 && (
            <div className="px-4 py-5 text-center">
              <p className="text-sm text-gray-400 mb-2">No products match &ldquo;{debouncedQuery}&rdquo;</p>
              <button
                type="submit"
                onMouseDown={() => onSubmitAll(debouncedQuery)}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Search all categories →
              </button>
            </div>
          )}

          {!liveLoading && filteredSuggestions.length > 0 && (
            <div className="border-t border-gray-50 px-4 py-2.5">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Related</p>
              <div className="flex flex-wrap gap-1.5">
                {filteredSuggestions.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onMouseDown={() => onSuggestionClick(s.label)}
                    className="text-[11px] text-gray-600 bg-gray-100 hover:bg-primary/10 hover:text-primary px-2.5 py-1 rounded-full transition-colors"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!liveLoading && liveResults.length > 0 && (
            <div className="border-t border-gray-50">
              <button
                type="submit"
                onMouseDown={() => onSubmitAll(debouncedQuery)}
                className="w-full px-4 py-2.5 text-xs font-semibold text-primary hover:bg-primary/5 transition-colors text-center"
              >
                See all results for &ldquo;{debouncedQuery}&rdquo; →
              </button>
            </div>
          )}
        </>
      )}

      {/* Empty state: recent + trending */}
      {debouncedQuery.length < 2 && (
        <>
          {recentSearches.length > 0 && (
            <>
              <div className="px-4 py-2.5 border-b border-gray-50 flex items-center justify-between">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Recent</p>
                <button
                  type="button"
                  onMouseDown={clearRecentSearches}
                  className="text-[11px] text-gray-400 hover:text-red-500 transition-colors font-medium"
                >
                  Clear
                </button>
              </div>
              {recentSearches.map((term, idx) => {
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={term}
                    type="button"
                    onMouseDown={() => onSuggestionClick(term)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left ${isActive ? "bg-primary/5" : "hover:bg-gray-50"}`}
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                    <span className="text-sm text-gray-700 flex-1">{term}</span>
                    <X className="w-3 h-3 text-gray-300 hover:text-gray-500 shrink-0"
                      onMouseDown={(e) => { e.stopPropagation(); clearRecentSearches(); }} />
                  </button>
                );
              })}
            </>
          )}

          {trendingSuggestions.length > 0 && (
            <div className={`px-4 py-2.5 ${recentSearches.length > 0 ? "border-t border-gray-50" : "border-b border-gray-50"}`}>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Trending</p>
            </div>
          )}
          {trendingSuggestions.slice(0, 5).map((s, idx) => {
            const navIdx   = recentSearches.length + idx;
            const isActive = navIdx === activeIndex;
            return (
              <button
                key={s.label}
                type="button"
                onMouseDown={() => onSuggestionClick(s.label)}
                onMouseEnter={() => setActiveIndex(navIdx)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left ${isActive ? "bg-primary/5" : "hover:bg-gray-50"}`}
              >
                <Search className="w-4 h-4 text-gray-300 shrink-0" />
                <span className="text-sm text-gray-700 flex-1">{s.label}</span>
                <span className="text-[11px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{s.category}</span>
              </button>
            );
          })}
        </>
      )}
    </motion.div>
  );
}

// ─── Desktop search bar (with location picker + category selector) ────────────

export default function SearchBar({
  searchQuery, setSearchQuery,
  searchCategory, setSearchCategory,
  showSuggestions, setShowSuggestions,
  activeIndex, setActiveIndex,
  debouncedQuery, liveResults, liveLoading, filteredSuggestions,
  trendingSuggestions,
  recentSearches, clearRecentSearches,
  deliveryLocation, setDeliveryLocation,
  showLocationPicker, setShowLocationPicker,
  searchCategories,
  onSubmit, onSuggestionClick, onProductClick, onSubmitAll, onKeyDown,
}) {
  const categoryList = searchCategories?.length ? searchCategories : ["All Categories"];
  return (
    <>
      {/* Location picker — desktop only */}
      <div className="hidden lg:block relative shrink-0">
        <button
          onClick={() => setShowLocationPicker((v) => !v)}
          onBlur={() => setTimeout(() => setShowLocationPicker(false), 150)}
          className="flex flex-col items-start gap-0.5 px-3 py-1.5 rounded-xl hover:bg-gray-50 transition-colors group"
          aria-label="Change delivery location"
        >
          <span className="text-[10px] text-gray-400 font-medium leading-none">Deliver to</span>
          <span className="flex items-center gap-1 text-sm font-bold text-gray-900 group-hover:text-primary transition-colors">
            <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
            {deliveryLocation}
            <ChevronDown className="w-3 h-3 text-gray-400" />
          </span>
        </button>

        <AnimatePresence>
          {showLocationPicker && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full left-0 mt-2 w-52 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50"
            >
              <div className="px-4 py-3 border-b border-gray-50">
                <p className="text-xs font-semibold text-gray-500">Select delivery state</p>
              </div>
              <div className="max-h-56 overflow-y-auto py-1">
                {NIGERIAN_STATES.map((state) => (
                  <button
                    key={state}
                    onMouseDown={() => {
                      setDeliveryLocation(state);
                      setShowLocationPicker(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors flex items-center gap-2 ${
                      deliveryLocation === state
                        ? "bg-primary/5 text-primary font-semibold"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                    {state}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Search form — sm+ */}
      <form onSubmit={onSubmit} className="hidden sm:block sm:flex-1 min-w-0 relative">
        <div className="relative flex items-stretch h-11 rounded-xl overflow-hidden border-2 border-gray-200 focus-within:border-accent transition-colors group">
          {/* Category selector */}
          <div className="relative hidden sm:flex items-center bg-gray-50 border-r border-gray-200 shrink-0">
            <select
              value={searchCategory}
              onChange={(e) => setSearchCategory(e.target.value)}
              className="bg-transparent text-[12px] font-medium text-gray-700 pl-3 pr-7 h-full appearance-none outline-none cursor-pointer"
              aria-label="Search category"
            >
              {categoryList.map((cat) => (
                <option key={cat}>{cat}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
          </div>

          {/* Text input */}
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => { setShowSuggestions(false); setActiveIndex(-1); }, 150)}
            onKeyDown={onKeyDown}
            placeholder="Search products, brands, vendors…"
            className="flex-1 min-w-0 px-3 bg-white outline-none text-sm placeholder:text-gray-400 text-gray-900"
            autoComplete="off"
          />

          {/* Submit */}
          <button
            type="submit"
            className="flex items-center justify-center gap-1.5 bg-accent hover:bg-accent-dark text-white px-4 sm:px-5 font-semibold text-sm transition-colors shrink-0"
            aria-label="Search"
          >
            <Search className="w-4 h-4" />
            <span className="hidden sm:block">Search</span>
          </button>
        </div>

        <AnimatePresence>
          {showSuggestions && (
            <SuggestionsDropdown
              searchQuery={searchQuery}
              debouncedQuery={debouncedQuery}
              searchCategory={searchCategory}
              liveResults={liveResults}
              liveLoading={liveLoading}
              filteredSuggestions={filteredSuggestions}
              trendingSuggestions={trendingSuggestions}
              activeIndex={activeIndex}
              setActiveIndex={setActiveIndex}
              recentSearches={recentSearches}
              clearRecentSearches={clearRecentSearches}
              onSuggestionClick={onSuggestionClick}
              onProductClick={onProductClick}
              onSubmitAll={onSubmitAll}
            />
          )}
        </AnimatePresence>
      </form>

      {/* Mobile search row — xs only, rendered outside this component in Navbar */}
    </>
  );
}
