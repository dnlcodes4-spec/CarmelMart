"use client";

import { useState } from "react";
import Link from "next/link";
import NextImage from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Store,
  ShoppingCart,
  Users,
  Shield,
  ShieldCheck,
  Settings,
  Bell,
  Menu,
  X,
  LogOut,
  Sun,
  Moon,
  Package,
  Tag,
  AlertTriangle,
  Truck,
  Bike,
  BarChart2,
  Ticket,
  Wallet,
  Flame,
  Percent,
  Image,
  Flag,
  Mail,
  Inbox,
  Calculator,
  MapPin,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { logoutAction } from "@/app/actions/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useDashboardTheme } from "@/lib/useDashboardTheme";

const NAV_ITEMS = [
  { href: "/admin/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/vendors", label: "Vendors", icon: Store },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/categories", label: "Categories", icon: Tag },
  { href: "/admin/orders", label: "Orders", icon: ShoppingCart },
  { href: "/admin/disputes", label: "Disputes", icon: AlertTriangle },
  { href: "/admin/delivery-zones", label: "Delivery", icon: Truck },
  { href: "/admin/fastlink", label: "Pickup Points", icon: MapPin },
  { href: "/admin/riders", label: "Riders", icon: Bike },
  { href: "/admin/auth-requests", label: "Auth Requests", icon: ShieldCheck },
  { href: "/admin/financials", label: "Financials", icon: BarChart2 },
  { href: "/admin/promo-codes", label: "Promo Codes", icon: Ticket },
  { href: "/admin/flash-sales", label: "Flash Sales", icon: Flame },
  { href: "/admin/payouts", label: "Payouts", icon: Wallet },
  { href: "/admin/commission", label: "Commission", icon: Percent },
  { href: "/admin/fraud-flags", label: "Fraud Flags", icon: Flag },
  { href: "/admin/bulk-mail", label: "Bulk Mail", icon: Mail },
  { href: "/admin/support", label: "Support Inbox", icon: Inbox },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/kyc", label: "KYC Reviews", icon: Shield },
  { href: "/admin/accountants", label: "Accountants", icon: Calculator },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export default function AdminShell({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { dark, toggle, mounted } = useDashboardTheme("cm-admin-theme");

  const displayName = user?.first_name
    ? `${user.first_name} ${user.last_name ?? ""}`.trim()
    : (user?.email ?? "Admin");
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const handleLogout = async () => {
    await logoutAction();
    qc.invalidateQueries({ queryKey: ["auth-user"] });
    router.push("/login");
  };

  const isActive = (href) =>
    href === "/admin/dashboard" ? pathname === href : pathname.startsWith(href);

  const currentLabel =
    NAV_ITEMS.find((n) => isActive(n.href))?.label ?? "Admin";

  return (
    <div
      className={`flex min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors duration-200 ${mounted && dark ? "dark" : ""}`}
    >
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
          <Link href="/" className="flex flex-col gap-0.5 min-w-0">
            <div className="relative w-32 h-10">
              <NextImage
                src="/logo-black.png"
                alt="CarmelMart"
                fill
                className="object-contain object-left dark:hidden"
                priority
              />
              <NextImage
                src="/logo-white.png"
                alt="CarmelMart"
                fill
                className="object-contain object-left hidden dark:block"
                priority
              />
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 font-semibold uppercase tracking-wide">
              Admin Console
            </p>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg transition-colors"
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

        {/* User card + logout */}
        <div className="p-3 border-t border-gray-100 dark:border-gray-800 space-y-1">
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white font-bold text-xs shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                {displayName}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                Administrator
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          >
            <LogOut className="w-[18px] h-[18px]" /> Sign Out
          </button>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border-b border-gray-100 dark:border-gray-800 px-5 sm:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg transition-colors lg:hidden"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="font-bold text-gray-900 dark:text-gray-100">
                {currentLabel}
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">
                CarmelMart Administration
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Dark mode toggle */}
            <button
              onClick={toggle}
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
              className="p-2.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
            >
              {dark ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>

            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white font-bold text-xs shrink-0">
              {initials}
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 px-5 sm:px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
