"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Package, ShoppingCart, BarChart3,
  Wallet, Settings, Bell, Menu, X, LogOut, Store, Sun, Moon, Users, Gift, Truck,
  ShoppingBag, AlertTriangle, CheckCircle, Info, Crown,
} from "lucide-react";
import SubscriptionBadge from "@/components/shared/vendor/SubscriptionBadge";
import VendorKYCWall from "@/components/shared/vendor/VendorKYCWall";
import PickupPointPrompt from "@/components/shared/vendor/PickupPointPrompt";
import VendorBankAlert from "@/components/shared/vendor/VendorBankAlert";
import { useAuth } from "@/lib/auth-context";
import { logoutAction } from "@/app/actions/auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDashboardTheme } from "@/lib/useDashboardTheme";

const NOTIF_ICONS = {
  order:    { icon: ShoppingBag,   bg: "bg-blue-100 dark:bg-blue-900/30",   color: "text-blue-600 dark:text-blue-400"   },
  stock:    { icon: AlertTriangle, bg: "bg-amber-100 dark:bg-amber-900/30", color: "text-amber-600 dark:text-amber-400" },
  approved: { icon: CheckCircle,   bg: "bg-green-100 dark:bg-green-900/30", color: "text-green-600 dark:text-green-400" },
  default:  { icon: Info,          bg: "bg-gray-100 dark:bg-gray-700",      color: "text-gray-500 dark:text-gray-400"   },
};

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const qc  = useQueryClient();

  const { data } = useQuery({
    queryKey:  ["vendor-notifications"],
    queryFn:   async () => {
      const r = await fetch("/api/vendor/notifications");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to load notifications");
      return d;
    },
    refetchInterval: 60_000,
  });

  const notifications = data?.notifications ?? [];
  const unread        = data?.unreadCount    ?? 0;

  const markRead = useMutation({
    mutationFn: async (ids) => {
      const r = await fetch("/api/vendor/notifications", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(ids ? { ids } : {}),
      });
      if (!r.ok) throw new Error("Failed to mark notifications read");
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vendor-notifications"] }),
  });

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = () => {
    setOpen((v) => !v);
    if (!open && unread > 0) markRead.mutate(null); // mark all read on open
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={handleOpen}
        className="relative p-2.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">Notifications</p>
            {notifications.some((n) => !n.read) && (
              <button
                onClick={() => markRead.mutate(null)}
                className="text-xs text-primary font-semibold hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-gray-50 dark:divide-gray-700/50">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => {
                const cfg  = NOTIF_ICONS[n.type] ?? NOTIF_ICONS.default;
                const Icon = cfg.icon;
                const inner = (
                  <div className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30 ${n.read ? "" : "bg-blue-50/40 dark:bg-blue-900/10"}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${cfg.bg}`}>
                      <Icon className={`w-4 h-4 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">{n.title}</p>
                      {n.message && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{n.message}</p>}
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">{n.ago}</p>
                    </div>
                    {!n.read && <span className="w-2 h-2 bg-blue-500 rounded-full shrink-0 mt-2" />}
                  </div>
                );
                return n.link ? (
                  <Link key={n.id} href={n.link} onClick={() => setOpen(false)}>{inner}</Link>
                ) : (
                  <div key={n.id}>{inner}</div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const NAV_ITEMS = [
  { href: "/vendor/dashboard",     label: "Overview",      icon: LayoutDashboard },
  { href: "/vendor/products",      label: "Products",      icon: Package          },
  { href: "/vendor/orders",        label: "Orders",        icon: ShoppingCart     },
  { href: "/vendor/analytics",     label: "Analytics",     icon: BarChart3        },
  { href: "/vendor/customers",     label: "Customers",     icon: Users            },
  { href: "/vendor/referrals",     label: "Referrals",     icon: Gift             },
  { href: "/vendor/shipping",      label: "Shipping",      icon: Truck            },
  { href: "/vendor/wallet",        label: "Wallet",        icon: Wallet           },
  { href: "/vendor/subscription",  label: "Subscription",  icon: Crown            },
  { href: "/vendor/settings",      label: "Settings",      icon: Settings         },
];

const BOTTOM_TABS = [
  { href: "/vendor/dashboard", label: "Overview",  icon: LayoutDashboard },
  { href: "/vendor/orders",    label: "Orders",    icon: ShoppingCart    },
  { href: "/vendor/products",  label: "Products",  icon: Package         },
  { href: "/vendor/wallet",    label: "Wallet",    icon: Wallet          },
  { href: "/vendor/settings",  label: "Settings",  icon: Settings        },
];

export default function VendorShell({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname  = usePathname();
  const router    = useRouter();
  const qc        = useQueryClient();
  const { user }  = useAuth();
  const { dark, toggle, mounted } = useDashboardTheme("cm-vendor-theme");

  const displayName = user?.first_name
    ? `${user.first_name} ${user.last_name ?? ""}`.trim()
    : user?.email ?? "Vendor";
  const initials = displayName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  // Fetch subscription tier for the badge in the user card (soft fail — never blocks)
  const { data: subData } = useQuery({
    queryKey: ["vendor-subscription"],
    queryFn: () => fetch("/api/vendor/subscription").then((r) => r.json()),
    staleTime: 60_000,
    retry: false,
  });
  const vendorTier = subData?.tier ?? "free";

  // KYC gate — fetch once, stale after 30s; clears immediately after verification
  const { data: kycData } = useQuery({
    queryKey: ["vendor-kyc-status"],
    queryFn: () => fetch("/api/vendor/kyc-status").then((r) => r.json()),
    staleTime: 30_000,
    retry: false,
  });

  // Only block when we have a confirmed negative — never block on loading/error
  const kycIncomplete = kycData && (
    !kycData.nin_verified ||
    (kycData.verification_type === "nin_cac" && !kycData.cac_verified)
  );

  // One-time welcome redirect — fires once per vendor after first approval.
  // Mark as welcomed the moment they land on the welcome page so any subsequent
  // navigation (sidebar, bottom tabs, back button) works without being redirected back.
  useEffect(() => {
    if (!user?.id) return;
    if (pathname === "/vendor/welcome") {
      localStorage.setItem(`cm_vendor_welcomed_${user.id}`, "1");
      return;
    }
    if (!localStorage.getItem(`cm_vendor_welcomed_${user.id}`)) {
      router.push("/vendor/welcome");
    }
  }, [user?.id, pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSignOut = async () => {
    await logoutAction();
    qc.invalidateQueries({ queryKey: ["auth-user"] });
    router.push("/");
  };

  const isActive = (href) =>
    href === "/vendor/dashboard"
      ? pathname === href
      : pathname.startsWith(href);

  const currentLabel = NAV_ITEMS.find((n) => isActive(n.href))?.label ?? "Dashboard";

  return (
    <div className={`flex min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors duration-200 ${mounted && dark ? "dark" : ""}`}>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className={`fixed top-0 left-0 h-full w-64 bg-white dark:bg-gray-900 border-r border-gray-100 dark:border-gray-800 z-30 flex flex-col transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="px-5 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shrink-0">
              <Store className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-extrabold text-gray-900 dark:text-gray-100 leading-none truncate">CarmelMart</p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 font-medium">Vendor Portal</p>
            </div>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-2.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  active
                    ? "bg-primary text-white shadow-sm"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100"
                }`}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* User card */}
        <div className="p-3 border-t border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white font-bold text-sm shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{displayName}</p>
                <SubscriptionBadge tier={vendorTier} />
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{user?.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              title="Sign out"
              className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen min-w-0">

        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border-b border-gray-100 dark:border-gray-800 px-5 sm:px-8 py-4 flex items-center gap-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-3 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg transition-colors lg:hidden"
          >
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="flex-1 font-bold text-gray-900 dark:text-gray-100">{currentLabel}</h1>

          <div className="flex items-center gap-2">
            {/* Dark mode toggle */}
            <button
              onClick={toggle}
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
              className="p-2.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <NotificationBell />

            <Link
              href="/"
              className="p-2.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
              title="View store"
            >
              <Store className="w-5 h-5" />
            </Link>
          </div>
        </header>

        {/* Page content — extra bottom padding on mobile to clear the tab bar */}
        <main className="flex-1 px-5 sm:px-8 py-8 pb-24 lg:pb-8">
          {kycIncomplete ? <VendorKYCWall kycData={kycData} /> : children}
        </main>
      </div>

      {/* Bank-details alert — blocks until an unverified bank account is fixed.
          Rendered above (and before) the rider prompt so it takes priority. */}
      <VendorBankAlert enabled={!!kycData && !kycIncomplete} />

      {/* Pickup-point prompt — only once KYC is complete so it never stacks on the
          wall. Replaces the deprecated delivery-rider prompt: whether a vendor has
          their own rider stops mattering once Fast Link handles dispatch, whereas a
          pickup point is what Fast Link cannot work without. */}
      <PickupPointPrompt enabled={!!kycData && !kycIncomplete} />

      {/* ── Mobile bottom tab bar ────────────────────────────────────────── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 lg:hidden bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 flex items-stretch"
        style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
      >
        {BOTTOM_TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 pt-2.5 pb-1.5 text-[10px] font-semibold transition-colors min-h-[52px] ${
                active
                  ? "text-primary dark:text-primary"
                  : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400"
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
