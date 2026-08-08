"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ShoppingBag, Package, ChevronRight, Clock,
  CheckCircle, Truck, XCircle, RefreshCw, AlertCircle, UserPlus,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth-context";

async function fetchMyOrders() {
  const r = await fetch("/api/customer/orders");
  if (!r.ok) throw new Error("Failed to fetch orders");
  return r.json();
}

const STATUS_MAP = {
  pending:    { label: "Pending",    icon: Clock,        color: "bg-yellow-100 text-yellow-700" },
  confirmed:  { label: "Confirmed",  icon: CheckCircle,  color: "bg-blue-100 text-blue-700" },
  processing: { label: "Processing", icon: RefreshCw,    color: "bg-blue-100 text-blue-700" },
  shipped:    { label: "Shipped",    icon: Truck,        color: "bg-purple-100 text-purple-700" },
  delivered:  { label: "Delivered",  icon: CheckCircle,  color: "bg-green-100 text-green-700" },
  cancelled:  { label: "Cancelled",  icon: XCircle,      color: "bg-red-100 text-red-700" },
  refunded:   { label: "Refunded",   icon: AlertCircle,  color: "bg-gray-100 text-gray-600" },
};

const TABS = ["All", "Pending", "Processing", "Shipped", "Delivered", "Cancelled"];

export default function OrdersPage() {
  const { isAuthenticated, isGuest, isLoading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState("All");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["my-orders"],
    queryFn: fetchMyOrders,
    enabled: isAuthenticated && !isGuest,
    staleTime: 60_000,
  });

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center px-4">
          <ShoppingBag className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Sign in to view orders</h2>
          <Link href="/login?from=/orders" className="text-primary font-semibold hover:underline">Sign In</Link>
        </div>
      </div>
    );
  }

  // Guests can track a specific order via direct URL but not browse history
  if (isGuest) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl border border-gray-100 shadow-xl p-6 sm:p-10 max-w-md w-full text-center"
        >
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-5">
            <UserPlus className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Create an account to see your orders</h2>
          <p className="text-sm text-gray-500 mb-2">
            Guest sessions are tied to this browser. Create a free account to access your order history from any device, any time.
          </p>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-6">
            If you just placed an order, use the tracking link in your confirmation email or create an account below — your order will be waiting.
          </p>
          <div className="flex flex-col gap-3">
            <Link
              href="/convert-account"
              className="flex items-center justify-center gap-2 py-3 rounded-full bg-primary text-white font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              <UserPlus className="w-4 h-4" />
              Create Free Account
            </Link>
            <Link
              href="/shop"
              className="flex items-center justify-center gap-2 py-3 rounded-full border-2 border-gray-200 text-gray-700 font-semibold text-sm hover:border-gray-400 transition-colors"
            >
              Continue Shopping
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  const allOrders = data?.orders ?? [];
  const filtered = activeTab === "All"
    ? allOrders
    : allOrders.filter((o) => o.status?.toLowerCase() === activeTab.toLowerCase());

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-10">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">My Orders</h1>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto pb-2 mb-6 scrollbar-none">
          {TABS.map((tab) => {
            const count = tab === "All"
              ? allOrders.length
              : allOrders.filter((o) => o.status?.toLowerCase() === tab.toLowerCase()).length;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`shrink-0 px-4 py-2.5 rounded-full text-sm font-semibold transition-colors ${
                  activeTab === tab
                    ? "bg-primary text-white"
                    : "bg-white border border-gray-200 text-gray-600 hover:border-primary hover:text-primary"
                }`}
              >
                {tab}
                {count > 0 && (
                  <span className={`ml-1.5 text-xs ${activeTab === tab ? "text-white/70" : "text-gray-400"}`}>
                    ({count})
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-gray-200 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-1/3" />
                  <div className="h-3 bg-gray-200 rounded w-2/3" />
                  <div className="h-3 bg-gray-200 rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="text-center py-16">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <p className="text-gray-600 mb-4">Could not load orders. Please try again.</p>
            <Link href="/shop" className="text-primary font-semibold hover:underline">Continue Shopping</Link>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !isError && filtered.length === 0 && (
          <div className="text-center py-16">
            <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              {activeTab === "All" ? "No orders yet" : `No ${activeTab.toLowerCase()} orders`}
            </h2>
            <p className="text-gray-500 mb-6">
              {activeTab === "All"
                ? "Your order history will appear here once you place an order."
                : `You have no orders with "${activeTab}" status.`}
            </p>
            {activeTab === "All" && (
              <Link href="/shop" className="bg-primary text-white font-semibold px-8 py-3.5 rounded-full hover:opacity-90 transition-opacity">
                Start Shopping
              </Link>
            )}
          </div>
        )}

        {/* Order list */}
        {!isLoading && !isError && filtered.length > 0 && (
          <div className="space-y-4">
            {filtered.map((order) => {
              const status = STATUS_MAP[order.status] ?? STATUS_MAP.pending;
              const StatusIcon = status.icon;
              return (
                <Link key={order.id} href={`/orders/${order.id}`}>
                  <div className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md hover:border-gray-200 transition-all duration-200 flex items-center gap-4">
                    {/* First product image or icon */}
                    <div className="w-14 h-14 rounded-xl bg-gray-100 overflow-hidden shrink-0">
                      {order.firstImage ? (
                        <Image
                          src={order.firstImage}
                          alt={order.firstItem ?? "Order"}
                          width={56}
                          height={56}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-primary/10">
                          <Package className="w-6 h-6 text-primary" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="font-bold text-gray-900 text-sm">{order.shortId}</p>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 ${status.color}`}>
                          <StatusIcon className="w-3 h-3" />
                          {status.label}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 line-clamp-1 mb-1">
                        {order.firstItem}
                        {order.itemCount > 1 ? ` + ${order.itemCount - 1} more` : ""}
                      </p>
                      {/* All three delivery problem states read as "shipped", so
                          the status chip alone cannot show something is wrong. */}
                      {order.hasDeliveryIssue && (
                        <span className="inline-flex items-center gap-1 mb-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          Delivery issue
                        </span>
                      )}
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span>{order.date}</span>
                        <span>·</span>
                        <span className="font-semibold text-gray-900">₦{order.total.toLocaleString()}</span>
                      </div>
                    </div>

                    <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
