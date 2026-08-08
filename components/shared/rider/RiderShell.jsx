"use client";


// ─── DEPRECATED · in-house delivery ──────────────────────────────────────────
// Superseded by the Fast Link integration (phase 5). Slated for removal once
// every vendor has a Fast Link pickup address and DELIVERY_INHOUSE_ENABLED=false
// has run clean in production. Gate lives at config.delivery.inHouseEnabled.
// orders.rider_id is NOT part of this removal — historical orders keep it.
// Inventory: docs/superpowers/specs/2026-08-08-inhouse-delivery-retirement.md
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bike, Package, Menu, X, LogOut, Sun, Moon, Store, Download } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { logoutAction } from "@/app/actions/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useDashboardTheme } from "@/lib/useDashboardTheme";
import { usePWAInstall } from "@/lib/pwa-install-context";

const NAV_ITEMS = [
  { href: "/rider/orders", label: "My Deliveries", icon: Package },
];

export default function RiderShell({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const router   = useRouter();
  const qc       = useQueryClient();
  const { user } = useAuth();
  const { dark, toggle, mounted } = useDashboardTheme("cm-rider-theme");
  const { canInstall, isStandalone, triggerInstall, isIOS } = usePWAInstall() ?? {};

  const displayName = user?.first_name
    ? `${user.first_name} ${user.last_name ?? ""}`.trim()
    : user?.email ?? "Rider";
  const initials = displayName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  const handleSignOut = async () => {
    await logoutAction();
    qc.invalidateQueries({ queryKey: ["auth-user"] });
    router.push("/login");
  };

  const isActive = (href) => pathname.startsWith(href);

  return (
    <div className={`flex min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors duration-200 ${mounted && dark ? "dark" : ""}`}>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — desktop always visible, mobile as drawer */}
      <aside className={`fixed top-0 left-0 h-full w-60 bg-white dark:bg-gray-900 border-r border-gray-100 dark:border-gray-800 z-30 flex flex-col transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {/* Logo */}
        <div className="px-5 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0">
              <Bike className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-extrabold text-gray-900 dark:text-gray-100 leading-none truncate text-sm">CarmelMart</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 font-semibold uppercase tracking-wide mt-0.5">Rider Portal</p>
            </div>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  active
                    ? "bg-emerald-600 text-white shadow-sm"
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
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{displayName}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">Rider</p>
            </div>
            <button
              onClick={handleSignOut}
              title="Sign out"
              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 lg:ml-60 flex flex-col min-h-screen min-w-0">
        {/* Compact top bar — optimised for one-hand reach */}
        <header className="sticky top-0 z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-100 dark:border-gray-800 px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2.5 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-xl transition-colors lg:hidden"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Rider avatar — visible on mobile since sidebar is hidden */}
          <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-xs shrink-0 lg:hidden">
            {initials}
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 dark:text-gray-100 text-sm leading-tight truncate">{displayName}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Rider Portal</p>
          </div>

          <div className="flex items-center gap-1">
            {/* Install nudge — only shown when app is not yet installed */}
            {canInstall && !isStandalone && !isIOS && (
              <button
                onClick={() => triggerInstall?.()}
                title="Install app for faster access"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-700 rounded-xl transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Install
              </button>
            )}
            {/* iOS: browser install prompt unavailable — show manual hint instead */}
            {isIOS && !isStandalone && (
              <span
                title="Tap Share → Add to Home Screen to install"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 rounded-xl cursor-default select-none"
              >
                <Download className="w-3.5 h-3.5" />
                Share → Add to Home
              </span>
            )}
            <button
              onClick={toggle}
              className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            {/* <Link
              href="/"
              className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
              title="View store"
            >
              <Store className="w-4 h-4" />
            </Link> */}
            <button
              onClick={handleSignOut}
              className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors lg:hidden"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Content — pb accounts for iOS home indicator */}
        <main
          className="flex-1 px-4 sm:px-6 py-5"
          style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
