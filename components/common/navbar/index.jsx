"use client";
// @portal: buyer
// @surface: global navigation

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  ShoppingCart,
  User,
  Heart,
  Menu,
  Package,
  Settings,
  TrendingUp,
  ChevronDown,
  Download,
  Bike,
  Calculator,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";

import { useAuth } from "@/lib/auth-context";
import { useCartStore } from "@/store/cartStore";
import { useUIStore } from "@/store/uiStore";
import { logoutAction } from "@/app/actions/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePWAInstall } from "@/lib/pwa-install-context";

import { PROMO_MESSAGES } from "./navbar.data";
import { useTrendingSearches } from "@/lib/useTrendingSearches";
import { useCategories } from "@/lib/useCategories";
import PromoStrip from "./PromoStrip";
import SearchBar, { SuggestionsDropdown } from "./SearchBar";
import CategoryBar from "./CategoryBar";
import CartPreview from "./CartPreview";
import AccountDropdown from "./AccountDropdown";
import MobileDrawer from "./MobileDrawer";

export default function Navbar() {
  const pathname = usePathname();

  // ── UI state ──────────────────────────────────────────────────────────────
  const [isScrolled, setIsScrolled] = useState(false);
  const [promoIndex, setPromoIndex] = useState(0);
  const [promoVisible, setPromoVisible] = useState(true);

  // Only show the promo strip and category bar on shopping-focused pages.
  const isShoppingPage = /^\/$|^\/shop(\/|$)|^\/product\/|^\/categories\//.test(pathname);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchCategory, setSearchCategory] = useState("All Categories");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showCartPreview, setShowCartPreview] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [activeCategory, setActiveCategory] = useState("All Departments");
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const cartHoverTimer = useRef(null);
  const accountHoverTimer = useRef(null);

  // ── Stores / auth ─────────────────────────────────────────────────────────
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    user,
    role,
    isAuthenticated,
    isLoading,
    isVendor,
    isCustomer,
    isAdmin,
    isRider,
    isAccountant,
  } = useAuth();
  const { canInstall, isIOS, triggerInstall } = usePWAInstall() ?? {};

  const cartItems = useCartStore((s) => s.items);
  const cartCount = cartItems.reduce((sum, i) => sum + i.quantity, 0);
  const cartTotal = cartItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const wishlistCount = useUIStore((s) => s.wishlist.length);
  const deliveryLocation = useUIStore((s) => s.deliveryLocation);
  const setDeliveryLocation = useUIStore((s) => s.setDeliveryLocation);
  const recentSearches = useUIStore((s) => s.recentSearches);
  const addRecentSearch = useUIStore((s) => s.addRecentSearch);
  const clearRecentSearches = useUIStore((s) => s.clearRecentSearches);

  // ── Derived display values ────────────────────────────────────────────────
  const firstName = user?.first_name ?? user?.email?.split("@")[0] ?? "Guest";
  const displayName = user?.first_name
    ? `${user.first_name} ${user.last_name ?? ""}`.trim()
    : (user?.email?.split("@")[0] ?? "Account");
  const displayRole = role
    ? role.charAt(0).toUpperCase() + role.slice(1)
    : "Customer";
  const initials = displayName.slice(0, 2).toUpperCase();

  const accountLinks = isAuthenticated
    ? [
        ...(isCustomer
          ? [{ label: "My Account", href: "/my-account", icon: User }]
          : []),
        ...(isVendor
          ? [{ label: "Vendor Dashboard", href: "/vendor/dashboard", icon: TrendingUp }]
          : []),
        ...(isRider
          ? [{ label: "Rider Portal", href: "/rider/orders", icon: Bike }]
          : []),
        ...(isAdmin
          ? [{ label: "Admin Panel", href: "/admin/dashboard", icon: Settings }]
          : []),
        ...(isAccountant
          ? [{ label: "Finance Portal", href: "/accountant/dashboard", icon: Calculator }]
          : []),
        ...(isAdmin || isRider || isAccountant
          ? []
          : [{ label: "My Orders", href: "/orders", icon: Package }]),
        { label: "Settings", href: "/settings", icon: Settings },
      ]
    : [];

  // ── Search autocomplete ───────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 280);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [searchQuery]);

  // ── Categories (fetched once per session, shared across all components) ──────
  const { parents: parentCategories, subsByParent } = useCategories();
  const searchCategories = ["All Categories", ...parentCategories.map((c) => c.name)];

  // The dropdown holds a category NAME, but the API resolves a slug. Guessing
  // one by lowercasing ("Fashion & Style" -> "fashion & style", or
  // "fashion-&-style") never matched the real slug ("fashion-style"), so the
  // lookup failed and every category-scoped search returned zero results.
  const categorySlugFor = useCallback(
    (name) =>
      name === "All Categories"
        ? null
        : (parentCategories.find((c) => c.name === name)?.slug ?? null),
    [parentCategories],
  );

  const { data: liveData, isFetching: liveLoading } = useQuery({
    queryKey: ["search-autocomplete", debouncedQuery, searchCategory],
    queryFn: async () => {
      const params = new URLSearchParams({
        search: debouncedQuery,
        per_page: "7",
      });
      const slug = categorySlugFor(searchCategory);
      if (slug) params.set("category", slug);
      const r = await fetch(`/api/products?${params}`);
      return r.json();
    },
    enabled: debouncedQuery.length >= 2,
    staleTime: 30_000,
    keepPreviousData: true,
  });

  const liveResults = liveData?.products ?? [];

  // Derived from the live catalogue, so every chip returns results. The list it
  // replaced was hardcoded (Nike Sneakers, iPhone 15 Pro, ...) and all nine
  // entries matched nothing in this store.
  const { suggestions: trendingSuggestions } = useTrendingSearches();

  const navItems = (() => {
    if (debouncedQuery.length >= 2)
      return liveResults.map((p) => ({ type: "product", data: p }));
    if (recentSearches.length > 0)
      return recentSearches.map((s) => ({ type: "recent", data: s }));
    return trendingSuggestions.slice(0, 5).map((s) => ({
      type: "trending",
      data: s,
    }));
  })();

  const filteredSuggestions =
    searchQuery.length >= 2
      ? trendingSuggestions
          .filter((s) => s.label.toLowerCase().includes(searchQuery.toLowerCase()))
          .slice(0, 3)
      : trendingSuggestions.slice(0, 5);

  // ── Search callbacks ──────────────────────────────────────────────────────
  const handleSearchSubmit = useCallback(
    (e) => {
      e.preventDefault();
      const q = searchQuery.trim();
      if (q) addRecentSearch(q);
      setShowSuggestions(false);
      setActiveIndex(-1);
      setIsMobileMenuOpen(false);
      const slug = categorySlugFor(searchCategory);
      const catParam = slug ? `&category=${encodeURIComponent(slug)}` : "";
      router.push(q ? `/shop?q=${encodeURIComponent(q)}${catParam}` : "/shop");
    },
    [router, searchQuery, searchCategory, addRecentSearch, categorySlugFor],
  );

  const handleSuggestionClick = useCallback(
    (label) => {
      addRecentSearch(label);
      setSearchQuery(label);
      setShowSuggestions(false);
      setActiveIndex(-1);
      setIsMobileMenuOpen(false);
      router.push(`/shop?q=${encodeURIComponent(label)}`);
    },
    [router, addRecentSearch],
  );

  const handleProductClick = useCallback(
    (product) => {
      addRecentSearch(product.name);
      setShowSuggestions(false);
      setActiveIndex(-1);
      router.push(`/product/${product.id}`);
    },
    [router, addRecentSearch],
  );

  const handleSubmitAll = useCallback(
    (query) => {
      addRecentSearch(query);
      setShowSuggestions(false);
      router.push(`/shop?q=${encodeURIComponent(query)}`);
    },
    [router, addRecentSearch],
  );

  const handleSearchKeyDown = useCallback(
    (e) => {
      if (!showSuggestions || navItems.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, navItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, -1));
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
        setActiveIndex(-1);
      } else if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        const item = navItems[activeIndex];
        if (item.type === "product") {
          handleProductClick(item.data);
        } else {
          handleSuggestionClick(
            item.type === "recent" ? item.data : item.data.label,
          );
        }
      }
    },
    [
      showSuggestions,
      navItems,
      activeIndex,
      handleProductClick,
      handleSuggestionClick,
    ],
  );

  // ── Auth callbacks ────────────────────────────────────────────────────────
  const handleSignOut = useCallback(async () => {
    await logoutAction();
    queryClient.invalidateQueries({ queryKey: ["auth-user"] });
    setIsMobileMenuOpen(false);
    setShowAccountDropdown(false);
  }, [queryClient]);

  // ── Cart / account hover ──────────────────────────────────────────────────
  const handleCartEnter = () => {
    clearTimeout(cartHoverTimer.current);
    setShowCartPreview(true);
  };
  const handleCartLeave = () => {
    cartHoverTimer.current = setTimeout(() => setShowCartPreview(false), 180);
  };
  const handleAccountEnter = () => {
    clearTimeout(accountHoverTimer.current);
    setShowAccountDropdown(true);
  };
  const handleAccountLeave = () => {
    accountHoverTimer.current = setTimeout(
      () => setShowAccountDropdown(false),
      180,
    );
  };

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!promoVisible) return;
    const t = setInterval(
      () => setPromoIndex((i) => (i + 1) % PROMO_MESSAGES.length),
      4000,
    );
    return () => clearInterval(t);
  }, [promoVisible]);

  useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? "hidden" : "";
    const onKey = (e) => {
      if (e.key === "Escape") setIsMobileMenuOpen(false);
    };
    if (isMobileMenuOpen) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobileMenuOpen]);

  useEffect(
    () => () => {
      clearTimeout(cartHoverTimer.current);
      clearTimeout(accountHoverTimer.current);
    },
    [],
  );

  // ── Shared search props ───────────────────────────────────────────────────
  const searchProps = {
    searchQuery,
    setSearchQuery,
    searchCategory,
    setSearchCategory,
    showSuggestions,
    setShowSuggestions,
    activeIndex,
    setActiveIndex,
    debouncedQuery,
    liveResults,
    liveLoading,
    filteredSuggestions,
    trendingSuggestions,
    recentSearches,
    clearRecentSearches,
    searchCategories,
    onSubmit: handleSearchSubmit,
    onSuggestionClick: handleSuggestionClick,
    onProductClick: handleProductClick,
    onSubmitAll: handleSubmitAll,
    onKeyDown: handleSearchKeyDown,
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Promo strip — shopping pages only */}
      <AnimatePresence>
        {promoVisible && isShoppingPage && (
          <PromoStrip
            promoIndex={promoIndex}
            onDismiss={() => setPromoVisible(false)}
          />
        )}
      </AnimatePresence>

      {/* Main header */}
      <motion.header
        animate={{
          boxShadow: isScrolled
            ? "0 2px 20px rgba(0,0,0,0.12)"
            : "0 1px 4px rgba(0,0,0,0.06)",
        }}
        transition={{ duration: 0.2 }}
        className="sticky top-0 z-50 bg-white"
      >
        {/* ── Main bar ── */}
        <div className="max-w-screen-2xl mx-auto px-3 sm:px-5 lg:px-8">
          <div className="flex items-center justify-between sm:justify-start gap-3 lg:gap-5 h-14 sm:h-[70px]">
            {/* Logo */}
            <Link href="/" className="shrink-0">
              <div className="relative w-32 lg:w-36 h-9 sm:h-10">
                <Image
                  src="/logo-black.png"
                  alt="CarmelMart"
                  fill
                  className="object-contain"
                  priority
                />
              </div>
            </Link>

            {/* Search bar + location picker */}
            <SearchBar
              {...searchProps}
              deliveryLocation={deliveryLocation}
              setDeliveryLocation={setDeliveryLocation}
              showLocationPicker={showLocationPicker}
              setShowLocationPicker={setShowLocationPicker}
            />

            {/* Right actions */}
            <div className="flex items-center gap-1 shrink-0">
              {/* Wishlist */}
              <Link
                href="/wishlist"
                className="flex flex-col items-center gap-0.5 p-2.5 rounded-xl hover:bg-gray-50 transition-colors group"
                aria-label={`Wishlist, ${wishlistCount} items`}
              >
                <div className="relative">
                  <Heart className="w-6 h-6 text-gray-700 group-hover:text-primary transition-colors" />
                  {wishlistCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-accent text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {wishlistCount > 99 ? "99+" : wishlistCount}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium text-gray-600 hidden lg:block">
                  Wishlist
                </span>
              </Link>

              {/* Account */}
              <div
                className="hidden md:block relative"
                onMouseEnter={handleAccountEnter}
                onMouseLeave={handleAccountLeave}
              >
                {isLoading ? (
                  <div className="px-2 py-1">
                    <div className="w-24 h-8 bg-gray-100 rounded-xl animate-pulse" />
                  </div>
                ) : (
                  <button
                    className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-gray-50 transition-colors group"
                    aria-label="Account"
                    aria-expanded={showAccountDropdown}
                  >
                    {isAuthenticated ? (
                      <div className="w-8 h-8 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center ring-2 ring-primary/20 shrink-0">
                        {initials}
                      </div>
                    ) : (
                      <User className="w-6 h-6 text-gray-700 shrink-0" />
                    )}
                    <div className="hidden lg:flex flex-col items-start leading-tight gap-1.5">
                      <span className="text-[10px] text-gray-400 font-medium">
                        Hello,{" "}
                        {isAuthenticated ? firstName.split(" ")[0] : "sign in"}
                      </span>
                      <span className="flex items-center gap-0.5 text-[13px] font-bold text-gray-900">
                        Account &amp; Lists
                        <ChevronDown className="w-3 h-3 text-gray-500 mt-px" />
                      </span>
                    </div>
                  </button>
                )}

                <AnimatePresence>
                  {showAccountDropdown && !isLoading && (
                    <AccountDropdown
                      onEnter={handleAccountEnter}
                      onLeave={handleAccountLeave}
                      isAuthenticated={isAuthenticated}
                      initials={initials}
                      displayName={displayName}
                      displayRole={displayRole}
                      firstName={firstName}
                      accountLinks={accountLinks}
                      onSignOut={handleSignOut}
                      onClose={() => setShowAccountDropdown(false)}
                    />
                  )}
                </AnimatePresence>
              </div>

              {/* Returns & Orders */}
              <Link
                href={isAuthenticated ? "/my-account/orders" : "/login"}
                className="hidden lg:flex flex-col items-start gap-0.5 px-2 py-1.5 rounded-xl hover:bg-gray-50 transition-colors"
                aria-label="Returns and Orders"
              >
                <span className="text-[10px] text-gray-400 font-medium leading-none">
                  Returns
                </span>
                <span className="text-[13px] font-bold text-gray-900">
                  &amp; Orders
                </span>
              </Link>

              {/* Get App — shown when PWA is installable */}
              {canInstall && (
                <button
                  onClick={() => (isIOS ? null : triggerInstall?.())}
                  className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 border-primary text-primary text-[12px] font-bold hover:bg-primary hover:text-white transition-colors shrink-0"
                  aria-label="Install CarmelMart app"
                >
                  <Download className="w-3.5 h-3.5" />
                  Get App
                </button>
              )}

              {/* Cart */}
              <div
                className="relative"
                onMouseEnter={handleCartEnter}
                onMouseLeave={handleCartLeave}
              >
                <Link
                  href="/cart"
                  className="flex items-center gap-2 p-2.5 rounded-xl hover:bg-gray-50 transition-colors group"
                  aria-label={`Cart, ${cartCount} items`}
                >
                  <div className="relative">
                    <ShoppingCart className="w-6 h-6 sm:w-7 sm:h-7 text-gray-800 group-hover:text-primary transition-colors" />
                    {cartCount > 0 && (
                      <motion.span
                        key={cartCount}
                        initial={{ scale: 1.4 }}
                        animate={{ scale: 1 }}
                        className="absolute -top-2 -right-2 min-w-5 h-5 px-1 bg-accent text-white text-[11px] font-bold rounded-full flex items-center justify-center"
                      >
                        {cartCount > 99 ? "99+" : cartCount}
                      </motion.span>
                    )}
                  </div>
                  <div className="hidden lg:flex flex-col items-start leading-tight">
                    {cartCount > 0 ? (
                      <span className="text-[10px] text-gray-400">
                        ₦{cartTotal.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-400">Empty</span>
                    )}
                    <span className="text-[13px] font-bold text-gray-900">
                      Cart
                    </span>
                  </div>
                </Link>

                <AnimatePresence>
                  {showCartPreview && (
                    <CartPreview
                      cartItems={cartItems}
                      cartCount={cartCount}
                      cartTotal={cartTotal}
                      onEnter={handleCartEnter}
                      onLeave={handleCartLeave}
                    />
                  )}
                </AnimatePresence>
              </div>

              {/* Hamburger — mobile only */}
              <div className="md:hidden flex items-center">
                <div className="w-px h-6 bg-gray-200 mr-2" />
                <motion.button
                  onClick={() => setIsMobileMenuOpen(true)}
                  className="p-2.5 text-gray-700 rounded-xl hover:bg-gray-100 active:bg-gray-200 transition-colors"
                  whileTap={{ scale: 0.93 }}
                  aria-label="Open menu"
                >
                  <Menu className="w-5 h-5" />
                </motion.button>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile full-width search row — shopping pages only */}
        <div className={`sm:hidden px-3 pb-3 ${isShoppingPage ? "" : "hidden"}`}>
          <form onSubmit={handleSearchSubmit} className="relative">
            <div className="flex items-stretch h-11 rounded-xl overflow-hidden border-2 border-gray-200 focus-within:border-accent transition-colors">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() =>
                  setTimeout(() => {
                    setShowSuggestions(false);
                    setActiveIndex(-1);
                  }, 150)
                }
                onKeyDown={handleSearchKeyDown}
                placeholder="Search products, brands, vendors…"
                className="flex-1 min-w-0 px-4 bg-white outline-none text-sm placeholder:text-gray-400 text-gray-900"
                autoComplete="off"
              />
              <button
                type="submit"
                className="flex items-center justify-center bg-accent hover:bg-accent-dark text-white px-4 font-semibold transition-colors shrink-0"
                aria-label="Search"
              >
                <Search className="w-4 h-4" />
              </button>
            </div>
            <AnimatePresence>
              {showSuggestions && <SuggestionsDropdown {...searchProps} />}
            </AnimatePresence>
          </form>
        </div>

        {/* Category bar — shopping pages only */}
        {isShoppingPage && (
          <CategoryBar
            categories={parentCategories}
            subsByParent={subsByParent}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
          />
        )}
      </motion.header>

      {/* Mobile drawer */}
      <MobileDrawer
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        isAuthenticated={isAuthenticated}
        isCustomer={isCustomer}
        isVendor={isVendor}
        isRider={isRider}
        isAdmin={isAdmin}
        isAccountant={isAccountant}
        initials={initials}
        displayName={displayName}
        displayRole={displayRole}
        accountLinks={accountLinks}
        onSignOut={handleSignOut}
        cartCount={cartCount}
        wishlistCount={wishlistCount}
        categories={parentCategories}
        {...searchProps}
        onSearchSubmit={handleSearchSubmit}
        onSearchKeyDown={handleSearchKeyDown}
      />
    </>
  );
}
