"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useCategories } from "@/lib/useCategories";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, SlidersHorizontal, X, Star, ShoppingCart, Heart,
  ChevronDown, Grid3X3, List, ChevronLeft, ChevronRight,
  CheckCircle, Flame, Tag, LayoutGrid, Filter, Eye,
  Truck, BadgeCheck, Package, Home, ChevronRight as Chevron, Scale,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import toast from "react-hot-toast";
import { useCartStore } from "@/store/cartStore";
import { useUIStore } from "@/store/uiStore";

// ── Fetchers ─────────────────────────────────────────────────────────────────
async function fetchProducts(params) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null && v !== "" && v !== undefined))
  ).toString();
  const res = await fetch(`/api/products?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch products");
  return res.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const SORT_OPTIONS = [
  { label: "Best Match",      value: "relevance"  }, // shown first when a search query is active
  { label: "Most Popular",    value: "popular"    },
  { label: "Newest",          value: "newest"     },
  { label: "Best Discount",   value: "discount"   },
  { label: "Price: Low–High", value: "price_asc"  },
  { label: "Price: High–Low", value: "price_desc" },
  { label: "Top Rated",       value: "rating"     },
];

const RATING_OPTIONS = [
  { label: "Any Rating",   value: 0   },
  { label: "4.5 & above", value: 4.5 },
  { label: "4.0 & above", value: 4.0 },
  { label: "3.0 & above", value: 3.0 },
];

const CONDITION_OPTIONS = ["All", "New", "Used", "Refurbished"];
const DELIVERY_OPTIONS  = ["All", "Express (24hrs)", "Standard (2-5 days)"];

const BRAND_OPTIONS = [
  "Apple", "Samsung", "Nike", "Adidas", "Sony", "LG", "HP", "Lenovo",
  "Infinix", "Tecno", "Itel", "Xiaomi", "Hisense", "Haier",
];

const SIZE_OPTIONS = ["XS", "S", "M", "L", "XL", "XXL", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45"];

const COLOR_OPTIONS = [
  { name: "Black",  hex: "#111827" },
  { name: "White",  hex: "#F9FAFB" },
  { name: "Red",    hex: "#EF4444" },
  { name: "Blue",   hex: "#3B82F6" },
  { name: "Green",  hex: "#22C55E" },
  { name: "Yellow", hex: "#EAB308" },
  { name: "Pink",   hex: "#EC4899" },
  { name: "Purple", hex: "#A855F7" },
  { name: "Gray",   hex: "#6B7280" },
  { name: "Brown",  hex: "#92400E" },
];

const PER_PAGE = 12;

function Stars({ rating }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`w-3.5 h-3.5 ${n <= Math.round(rating) ? "fill-yellow-400 text-yellow-400" : "fill-gray-200 text-gray-200"}`} />
      ))}
    </div>
  );
}

// ── Quick View Modal ──────────────────────────────────────────────────────────
function QuickViewModal({ product, onClose, onAddToCart, onToggleWishlist, inWishlist }) {
  useEffect(() => {
    const handleKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const discount = product.salePrice
    ? Math.round((1 - product.salePrice / product.price) * 100)
    : null;
  const price = product.salePrice ?? product.price;
  const inStock = (product.stock ?? 1) > 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: "100%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: "100%", opacity: 0 }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="relative bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-xl shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto"
      >
        <button onClick={onClose} className="absolute top-4 right-4 z-10 w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors">
          <X className="w-4 h-4 text-gray-600" />
        </button>

        <div className="flex flex-col sm:flex-row">
          {/* Image */}
          <div className="relative h-64 sm:h-auto sm:w-56 sm:shrink-0 bg-gray-50">
            {product.image ? (
              <Image src={product.image} alt={product.name} fill className="object-cover" sizes="(max-width:640px) 100vw, 224px" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Package className="w-12 h-12 text-gray-300" />
              </div>
            )}
            {discount && (
              <div className="absolute top-3 left-3 bg-orange-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                -{discount}%
              </div>
            )}
          </div>

          {/* Info */}
          <div className="p-5 flex-1">
            {product.category && (
              <p className="text-xs text-primary font-semibold mb-1">{product.category.name}</p>
            )}
            <h3 className="text-base font-bold text-gray-900 mb-2 leading-snug">{product.name}</h3>

            {product.vendor && (
              <div className="flex items-center gap-1 mb-3">
                <p className="text-xs text-gray-500">{product.vendor.name}</p>
                {product.vendor.verified && <BadgeCheck className="w-3.5 h-3.5 text-blue-500" />}
              </div>
            )}

            <div className="flex items-center gap-2 mb-3">
              <Stars rating={product.avgRating} />
              <span className="text-xs text-gray-500">({product.reviewCount})</span>
              {product.soldCount > 0 && <span className="text-xs text-gray-400">· {product.soldCount} sold</span>}
            </div>

            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-xl font-bold text-gray-900">₦{price.toLocaleString()}</span>
              {product.salePrice && (
                <span className="text-sm text-gray-400 line-through">₦{product.price.toLocaleString()}</span>
              )}
            </div>

            {/* Delivery */}
            <div className="flex items-center gap-1.5 text-xs text-gray-600 mb-1">
              <Truck className="w-3.5 h-3.5 text-primary shrink-0" />
              <span>Estimated delivery: <span className="font-semibold text-gray-900">Tomorrow</span></span>
            </div>

            {/* Stock */}
            {product.stock > 0 && product.stock <= 10 && (
              <p className="text-xs text-amber-600 font-semibold mb-3">Only {product.stock} left in stock!</p>
            )}

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { onAddToCart(product); onClose(); }}
                disabled={!inStock}
                className="flex-1 flex items-center justify-center gap-2 bg-primary text-white text-sm font-bold py-2.5 rounded-full hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                <ShoppingCart className="w-4 h-4" /> Add to Cart
              </button>
              <button
                onClick={() => onToggleWishlist(product)}
                className={`p-2.5 rounded-full border-2 transition-colors ${inWishlist ? "border-red-400 bg-red-50 text-red-500" : "border-gray-200 text-gray-400 hover:text-red-500"}`}
              >
                <Heart className={`w-4 h-4 ${inWishlist ? "fill-current" : ""}`} />
              </button>
            </div>

            <Link
              href={`/product/${product.id}`}
              onClick={onClose}
              className="block text-center text-xs text-primary font-semibold mt-3 hover:underline"
            >
              View full details →
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Compare Modal ─────────────────────────────────────────────────────────────
function CompareModal({ products, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const ROWS = [
    { label: "Price",     render: (p) => `₦${(p.salePrice ?? p.price).toLocaleString()}` },
    { label: "Rating",    render: (p) => p.avgRating ? `${p.avgRating.toFixed(1)} ★` : "—" },
    { label: "Condition", render: (p) => p.condition ? p.condition.charAt(0).toUpperCase() + p.condition.slice(1) : "New" },
    { label: "Delivery",  render: (p) => (p.salePrice ?? p.price) >= 10000 ? "Free" : "Standard" },
    { label: "In Stock",  render: (p) => (p.stock ?? 1) > 0 ? "Yes" : "No" },
    { label: "Sizes",     render: (p) => p.attributes?.sizes?.join(", ") || "—" },
    { label: "Colors",    render: (p) => p.attributes?.colors?.join(", ") || "—" },
    { label: "Storage",   render: (p) => p.attributes?.storage?.join(", ") || "—" },
    { label: "RAM",       render: (p) => p.attributes?.ram?.join(", ") || "—" },
    { label: "Sold",      render: (p) => p.soldCount ? `${p.soldCount.toLocaleString()} units` : "—" },
  ].filter((row) => products.some((p) => {
    const v = row.render(p);
    return v && v !== "—";
  }));

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        className="relative bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-auto z-10"
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-3xl">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-primary" />
            <h2 className="font-bold text-gray-900">Compare Products</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="text-left text-xs font-bold text-gray-400 uppercase tracking-wider py-3 pr-4 min-w-[120px]">Feature</th>
                {products.map((p) => (
                  <th key={p.id} className="text-center min-w-[160px] pb-4 px-2">
                    <div className="relative h-32 rounded-2xl overflow-hidden bg-gray-50 mb-2">
                      {p.image && <Image src={p.image} alt={p.name} fill className="object-cover" sizes="160px" />}
                    </div>
                    <p className="text-xs font-bold text-gray-900 line-clamp-2">{p.name}</p>
                    <Link href={`/product/${p.id}`} className="text-[10px] text-primary hover:underline mt-0.5 block">
                      View full details →
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, ri) => (
                <tr key={row.label} className={ri % 2 === 0 ? "bg-gray-50" : "bg-white"}>
                  <td className="py-3 pr-4 text-xs font-semibold text-gray-500 whitespace-nowrap rounded-l-xl pl-3">{row.label}</td>
                  {products.map((p) => (
                    <td key={p.id} className="py-3 px-2 text-xs text-gray-900 text-center font-medium rounded-r-xl">
                      {row.render(p)}
                    </td>
                  ))}
                </tr>
              ))}
              {/* CTA row */}
              <tr>
                <td className="pt-4" />
                {products.map((p) => (
                  <td key={p.id} className="pt-4 px-2 text-center">
                    <Link
                      href={`/product/${p.id}`}
                      onClick={onClose}
                      className="inline-block w-full py-2 bg-primary text-white text-xs font-bold rounded-full hover:opacity-90 transition-opacity"
                    >
                      View Product
                    </Link>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}

// ── Product Card ──────────────────────────────────────────────────────────────
function ProductCard({ product, view, onAddToCart, onToggleWishlist, inWishlist, onQuickView, onCompare, inCompare }) {
  const discount = product.salePrice
    ? Math.round((1 - product.salePrice / product.price) * 100)
    : null;

  if (view === "list") {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 hover:shadow-md transition-shadow p-4 flex gap-4">
        <Link href={`/product/${product.id}`} className="shrink-0">
          <div className="relative w-32 h-32 rounded-xl overflow-hidden bg-gray-50">
            {product.image && <Image src={product.image} alt={product.name} fill className="object-cover" sizes="128px" />}
          </div>
        </Link>
        <div className="flex-1 min-w-0">
          {product.category && (
            <p className="text-xs text-primary font-semibold mb-1">{product.category.name}</p>
          )}
          <Link href={`/product/${product.id}`}>
            <h3 className="font-semibold text-gray-900 text-sm mb-1.5 line-clamp-2 hover:text-primary transition-colors">
              {product.name}
            </h3>
          </Link>
          {product.vendor && (
            <div className="flex items-center gap-1 mb-2">
              <p className="text-xs text-gray-500">{product.vendor.name}</p>
              {product.vendor.verified && <BadgeCheck className="w-3 h-3 text-blue-500" />}
            </div>
          )}
          <div className="flex items-center gap-1.5 mb-2">
            <Stars rating={product.avgRating} />
            <span className="text-xs text-gray-500">({product.reviewCount})</span>
            {product.soldCount > 0 && <span className="text-xs text-gray-400">· {product.soldCount} sold</span>}
          </div>
          {/* Stock badge */}
          {product.stock > 0 && product.stock <= 10 && (
            <div className="flex items-center gap-1.5 mb-3">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                product.stock <= 3 ? "text-red-600 bg-red-50" : "text-amber-600 bg-amber-50"
              }`}>
                Only {product.stock} left
              </span>
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-lg font-bold text-gray-900">
              ₦{(product.salePrice ?? product.price).toLocaleString()}
            </span>
            {product.salePrice && (
              <span className="text-sm text-gray-400 line-through">₦{product.price.toLocaleString()}</span>
            )}
            {discount && <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">{discount}% OFF</span>}
          </div>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <button onClick={() => onToggleWishlist(product)} className={`p-2 rounded-full border transition-colors ${inWishlist ? "bg-red-50 border-red-200 text-red-500" : "border-gray-200 text-gray-400 hover:text-red-500"}`}>
            <Heart className={`w-4 h-4 ${inWishlist ? "fill-current" : ""}`} />
          </button>
          <button onClick={() => onQuickView(product)} className="p-2 rounded-full border border-gray-200 text-gray-400 hover:text-primary hover:border-primary transition-colors">
            <Eye className="w-4 h-4" />
          </button>
          <button
            onClick={() => onAddToCart(product)}
            className="flex items-center gap-1.5 bg-primary text-white text-xs font-bold px-4 py-2.5 rounded-full hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            <ShoppingCart className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      layout
      whileHover={{ y: -4 }}
      className="group bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-xl transition-all duration-300 flex flex-col"
    >
      <Link href={`/product/${product.id}`}>
        <div className="relative aspect-square overflow-hidden bg-gray-50">
          {product.image && (
            <Image src={product.image} alt={product.name} fill sizes="(max-width: 767px) 50vw, (max-width: 1279px) 33vw, 300px" className="object-cover group-hover:scale-105 transition-transform duration-500" />
          )}
          {/* Badges */}
          <div className="absolute top-3 left-3 flex flex-col gap-1">
            {product.badge && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                product.badge.includes("OFF") || product.badge === "Sale" ? "bg-orange-500 text-white"
                  : product.badge === "Hot" || product.badge === "Trending" ? "bg-red-500 text-white"
                  : product.badge === "New" ? "bg-blue-500 text-white"
                  : "bg-primary text-white"
              }`}>
                {product.badge}
              </span>
            )}
            {discount && !product.badge && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-orange-500 text-white">-{discount}%</span>
            )}
            {product.condition && product.condition !== "new" && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                product.condition === "used" ? "bg-yellow-500 text-white" : "bg-teal-500 text-white"
              }`}>
                {product.condition.charAt(0).toUpperCase() + product.condition.slice(1)}
              </span>
            )}
          </div>
          {/* Express delivery badge */}
          <div className="absolute top-3 right-10">
            {product.price >= 10000 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-500 text-white">FREE</span>
            )}
          </div>
          {/* Out of stock overlay */}
          {product.stock === 0 && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
              <span className="text-sm font-bold text-gray-500">Out of Stock</span>
            </div>
          )}
          {/* Low stock */}
          {product.stock > 0 && product.stock <= 10 && (
            <div className="absolute bottom-10 left-3">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                product.stock <= 3 ? "bg-red-500 text-white" : "bg-amber-500 text-white"
              }`}>
                Only {product.stock} left
              </span>
            </div>
          )}
          {/* Wishlist button */}
          <button
            onClick={(e) => { e.preventDefault(); onToggleWishlist(product); }}
            className={`absolute top-3 right-3 w-8 h-8 rounded-full shadow-md flex items-center justify-center transition-colors ${inWishlist ? "bg-red-500 text-white" : "bg-white text-gray-400 hover:text-red-500"}`}
          >
            <Heart className={`w-4 h-4 ${inWishlist ? "fill-current" : ""}`} />
          </button>
          {/* Compare toggle (bottom-left, grid only) */}
          {onCompare && (
            <button
              onClick={(e) => { e.preventDefault(); onCompare(product); }}
              className={`absolute bottom-10 right-3 w-6 h-6 rounded flex items-center justify-center border-2 transition-colors ${
                inCompare ? "bg-primary border-primary text-white" : "bg-white border-gray-300 text-transparent hover:border-primary"
              }`}
              title={inCompare ? "Remove from compare" : "Add to compare"}
              aria-label={inCompare ? "Remove from compare" : "Add to compare"}
            >
              {inCompare && <CheckCircle className="w-3.5 h-3.5" />}
            </button>
          )}
          {/* Mobile: persistent cart button — hover overlay is invisible on touch */}
          <button
            onClick={(e) => { e.preventDefault(); onAddToCart(product); }}
            disabled={product.stock === 0}
            className="sm:hidden absolute bottom-2 right-2 w-9 h-9 flex items-center justify-center bg-primary text-white rounded-full shadow-lg disabled:opacity-40 transition-opacity active:scale-95"
            aria-label="Add to cart"
          >
            <ShoppingCart className="w-4 h-4" />
          </button>
          {/* Desktop: hover overlay */}
          <div className="hidden sm:flex absolute inset-x-0 bottom-0 p-2 translate-y-full group-hover:translate-y-0 transition-transform duration-300 gap-1.5">
            <button
              onClick={(e) => { e.preventDefault(); onAddToCart(product); }}
              disabled={product.stock === 0}
              className="flex-1 flex items-center justify-center gap-1.5 bg-gray-900 text-white text-xs font-bold py-2 rounded-full hover:bg-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ShoppingCart className="w-3.5 h-3.5" /> Add
            </button>
            <button
              onClick={(e) => { e.preventDefault(); onQuickView(product); }}
              className="w-8 h-8 flex items-center justify-center bg-white text-gray-700 rounded-full hover:bg-gray-100 transition-colors shrink-0"
              title="Quick view"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </Link>
      <div className="p-3 sm:p-4 flex flex-col flex-1">
        {product.category && (
          <p className="text-xs font-semibold text-primary mb-1">{product.category.name}</p>
        )}
        <Link href={`/product/${product.id}`}>
          <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 mb-1.5 hover:text-primary transition-colors">
            {product.name}
          </h3>
        </Link>
        {product.vendor && (
          <div className="flex items-center gap-1 mb-1.5">
            <p className="text-xs text-gray-500 truncate">{product.vendor.name}</p>
            {product.vendor.verified && <BadgeCheck className="w-3 h-3 text-blue-500 shrink-0" />}
          </div>
        )}
        <div className="flex items-center gap-1.5 mb-2">
          <Stars rating={product.avgRating} />
          <span className="text-xs text-gray-500">({product.reviewCount})</span>
        </div>
        {/* Sold count */}
        {product.soldCount > 0 && (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] text-gray-400">{product.soldCount} sold</span>
          </div>
        )}
        {/* Color swatches from product attributes */}
        {(() => {
          const colors = product.attributes?.colors ?? [];
          if (!colors.length) return null;
          const shown = colors.slice(0, 5);
          const rest  = colors.length - shown.length;
          return (
            <div className="flex items-center gap-1 mb-2">
              {shown.map((name) => {
                const hex = COLOR_OPTIONS.find((c) => c.name.toLowerCase() === name.toLowerCase())?.hex;
                return hex ? (
                  <span
                    key={name}
                    title={name}
                    className="w-3.5 h-3.5 rounded-full border border-gray-200 shrink-0"
                    style={{ backgroundColor: hex }}
                  />
                ) : null;
              })}
              {rest > 0 && <span className="text-[10px] text-gray-400">+{rest}</span>}
            </div>
          );
        })()}
        <div className="mt-auto">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-bold text-gray-900">
              ₦{(product.salePrice ?? product.price).toLocaleString()}
            </span>
            {product.salePrice && (
              <span className="text-xs text-gray-400 line-through">₦{product.price.toLocaleString()}</span>
            )}
          </div>
          {discount && <p className="text-xs text-green-600 font-semibold mt-0.5">Save {discount}%</p>}
        </div>
      </div>
    </motion.div>
  );
}

// ── Price Range ───────────────────────────────────────────────────────────────
const PRICE_PRESETS = [
  { label: "Under ₦5k",    min: null,   max: 5000   },
  { label: "₦5k – ₦20k",   min: 5000,   max: 20000  },
  { label: "₦20k – ₦100k", min: 20000,  max: 100000 },
  { label: "₦100k+",       min: 100000, max: null   },
];

const toDigits     = (s) => s.replace(/\D/g, "");
const draftToValue = (s) => (s === "" ? null : Number(s));
const valueToDraft = (v) => (v == null ? "" : String(v));
const formatDraft  = (s) => (s === "" ? "" : Number(s).toLocaleString());

function PriceField({ value, onChange, onBlur, onKeyDown, label, placeholder }) {
  return (
    <div className="relative flex-1 min-w-0">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">₦</span>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        placeholder={placeholder}
        value={formatDraft(value)}
        onChange={(e) => onChange(toDigits(e.target.value))}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className="w-full pl-6 pr-2.5 py-2 rounded-xl border-2 border-gray-200 text-sm font-medium text-gray-900 placeholder:font-normal placeholder:text-gray-400 focus:border-primary focus:outline-none transition-colors"
      />
    </div>
  );
}

function PriceRangeInputs({ minPrice, maxPrice, onCommit }) {
  const [minDraft, setMinDraft] = useState(valueToDraft(minPrice));
  const [maxDraft, setMaxDraft] = useState(valueToDraft(maxPrice));

  // Sync when filters change externally (chip removal, reset, back/forward nav)
  useEffect(() => { setMinDraft(valueToDraft(minPrice)); }, [minPrice]);
  useEffect(() => { setMaxDraft(valueToDraft(maxPrice)); }, [maxPrice]);

  const commit = () => {
    let min = draftToValue(minDraft);
    let max = draftToValue(maxDraft);
    if (min !== null && max !== null && min > max) [min, max] = [max, min];
    if (min !== minPrice || max !== maxPrice) onCommit(min, max);
  };

  // Enter blurs the field, which commits via onBlur — no double fetch.
  const handleKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <PriceField
          value={minDraft}
          onChange={setMinDraft}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          label="Minimum price"
          placeholder="Min"
        />
        <span className="text-sm text-gray-400 shrink-0">–</span>
        <PriceField
          value={maxDraft}
          onChange={setMaxDraft}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          label="Maximum price"
          placeholder="Max"
        />
      </div>

      <div className="grid grid-cols-2 gap-1.5 mt-2.5">
        {PRICE_PRESETS.map((preset) => {
          const active = preset.min === minPrice && preset.max === maxPrice;
          return (
            <button
              key={preset.label}
              onClick={() => (active ? onCommit(null, null) : onCommit(preset.min, preset.max))}
              aria-pressed={active}
              className={`px-2 py-1.5 rounded-lg text-xs font-medium border-2 transition-colors ${
                active
                  ? "border-primary bg-primary text-white"
                  : "border-gray-200 text-gray-700 hover:border-primary/40"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Filter Section (collapsible) ──────────────────────────────────────────────
function FilterSection({ title, isActive = false, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-100 last:border-0 pb-3 last:pb-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between py-2 group"
      >
        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest group-hover:text-gray-700 transition-colors flex items-center gap-2">
          {title}
          {isActive && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
          )}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="pt-2 pb-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Categories filter with hierarchy ─────────────────────────────────────────
const CAT_SHOW_LIMIT = 7;

function CategoriesFilter({ filters, setFilter, parents, subsByParent }) {
  const [showAll, setShowAll] = useState(false);

  // Auto-expand the parent that owns the currently selected sub-category
  const initialExpanded = (() => {
    for (const [parentId, subs] of Object.entries(subsByParent)) {
      if (subs.some((s) => s.slug === filters.category)) return parentId;
    }
    return null;
  })();
  const [expandedParent, setExpandedParent] = useState(initialExpanded);

  const displayed = showAll ? parents : parents.slice(0, CAT_SHOW_LIMIT);
  const hidden = parents.length - CAT_SHOW_LIMIT;

  return (
    <div className="space-y-0.5">
      <button
        onClick={() => setFilter("category", null)}
        className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
          !filters.category ? "bg-primary text-white" : "text-gray-700 hover:bg-gray-100"
        }`}
      >
        All Products
      </button>

      {displayed.map((cat) => {
        const subs = subsByParent[cat.id] ?? [];
        const isSelected = filters.category === cat.slug;
        const hasActiveSub = subs.some((s) => s.slug === filters.category);
        const isExpanded = expandedParent === cat.id || hasActiveSub;

        return (
          <div key={cat.id}>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setFilter("category", cat.slug)}
                className={`flex-1 min-w-0 text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors flex items-center justify-between gap-2 ${
                  isSelected || hasActiveSub
                    ? "bg-primary text-white"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                <span className="truncate">{cat.name}</span>
                {cat.productCount > 0 && (
                  <span className={`text-xs shrink-0 ${isSelected || hasActiveSub ? "text-white/70" : "text-gray-400"}`}>
                    {cat.productCount}
                  </span>
                )}
              </button>
              {subs.length > 0 && (
                <button
                  onClick={() =>
                    setExpandedParent(isExpanded ? null : cat.id)
                  }
                  className={`p-1.5 rounded-lg shrink-0 transition-colors ${
                    isExpanded ? "text-primary bg-primary/5" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                  }`}
                  aria-label={isExpanded ? "Collapse subcategories" : "Expand subcategories"}
                >
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                  />
                </button>
              )}
            </div>

            <AnimatePresence initial={false}>
              {isExpanded && subs.length > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <div className="ml-3 pl-3 border-l-2 border-gray-100 mt-0.5 mb-0.5 space-y-0.5">
                    {subs.map((sub) => (
                      <button
                        key={sub.id}
                        onClick={() => setFilter("category", sub.slug)}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-between gap-2 ${
                          filters.category === sub.slug
                            ? "bg-primary/10 text-primary font-semibold"
                            : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                        }`}
                      >
                        <span className="truncate">{sub.name}</span>
                        {sub.productCount > 0 && (
                          <span className="text-[10px] text-gray-400 shrink-0">{sub.productCount}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {parents.length > CAT_SHOW_LIMIT && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="w-full text-left px-3 py-2 text-xs font-semibold text-primary hover:underline flex items-center gap-1"
        >
          {showAll ? (
            <>Show less <ChevronDown className="w-3 h-3 rotate-180" /></>
          ) : (
            <>+{hidden} more <ChevronDown className="w-3 h-3" /></>
          )}
        </button>
      )}
    </div>
  );
}

// ── Filter Sidebar ────────────────────────────────────────────────────────────
function FilterSidebar({ filters, setFilter, parents, subsByParent, isOpen, onClose }) {
  const hasPrice = filters.minPrice !== null || filters.maxPrice !== null;

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={onClose} />}

      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 lg:z-0
        w-72 lg:w-56 xl:w-64 bg-white lg:bg-transparent
        border-r lg:border-0 border-gray-100
        overflow-y-auto
        flex-shrink-0
        transition-transform duration-300
        lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-5rem)]
        ${isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}>
        <div className="p-5 lg:p-0 lg:pr-1 space-y-1">
          {/* Close (mobile) */}
          <div className="flex items-center justify-between mb-4 lg:hidden">
            <h2 className="font-bold text-gray-900">Filters</h2>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Categories */}
          <FilterSection
            title="Categories"
            isActive={!!filters.category}
            defaultOpen
          >
            <CategoriesFilter
              filters={filters}
              setFilter={setFilter}
              parents={parents}
              subsByParent={subsByParent}
            />
          </FilterSection>

          {/* Price Range */}
          <FilterSection
            title="Price Range"
            isActive={hasPrice}
            defaultOpen
          >
            <PriceRangeInputs
              minPrice={filters.minPrice}
              maxPrice={filters.maxPrice}
              onCommit={(min, max) => { setFilter("minPrice", min); setFilter("maxPrice", max); }}
            />
            {hasPrice && (
              <button
                onClick={() => { setFilter("minPrice", null); setFilter("maxPrice", null); }}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Clear price
              </button>
            )}
          </FilterSection>

          {/* Customer Rating */}
          <FilterSection title="Rating" isActive={!!filters.minRating} defaultOpen>
            <div className="space-y-0.5">
              {RATING_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFilter("minRating", opt.value || null)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${
                    filters.minRating === opt.value || (!filters.minRating && opt.value === 0)
                      ? "bg-primary text-white"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {opt.value > 0 ? (
                    <>
                      <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400 shrink-0" />
                      <span>{opt.label}</span>
                    </>
                  ) : opt.label}
                </button>
              ))}
            </div>
          </FilterSection>

          {/* Verified Sellers */}
          <FilterSection title="Seller" isActive={filters.verifiedOnly} defaultOpen={false}>
            <button
              onClick={() => setFilter("verifiedOnly", !filters.verifiedOnly)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium border-2 transition-colors ${
                filters.verifiedOnly
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-gray-200 text-gray-700 hover:border-primary/40"
              }`}
            >
              <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                filters.verifiedOnly ? "border-primary bg-primary" : "border-gray-300"
              }`}>
                {filters.verifiedOnly && (
                  <svg viewBox="0 0 10 8" fill="none" className="w-3 h-3">
                    <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span>Verified sellers only</span>
              <BadgeCheck className={`w-4 h-4 ml-auto shrink-0 ${filters.verifiedOnly ? "text-primary" : "text-gray-300"}`} />
            </button>
          </FilterSection>

          {/* Condition */}
          <FilterSection title="Condition" isActive={!!filters.condition} defaultOpen={false}>
            <div className="space-y-0.5">
              {CONDITION_OPTIONS.map((cond) => (
                <button
                  key={cond}
                  onClick={() => setFilter("condition", cond === "All" ? null : cond.toLowerCase())}
                  className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                    (cond === "All" && !filters.condition) || filters.condition === cond.toLowerCase()
                      ? "bg-primary text-white"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {cond}
                </button>
              ))}
            </div>
          </FilterSection>

          {/* Delivery */}
          <FilterSection title="Delivery" isActive={!!filters.delivery} defaultOpen={false}>
            <div className="space-y-0.5">
              {DELIVERY_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setFilter("delivery", opt === "All" ? null : opt)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${
                    (opt === "All" && !filters.delivery) || filters.delivery === opt
                      ? "bg-primary text-white"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {opt !== "All" && <Truck className="w-3.5 h-3.5 shrink-0" />}
                  <span>{opt}</span>
                </button>
              ))}
            </div>
          </FilterSection>

          {/* Brand */}
          <FilterSection title="Brand" isActive={!!filters.brand} defaultOpen={false}>
            <div className="space-y-0.5">
              <button
                onClick={() => setFilter("brand", null)}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                  filters.brand ? "text-gray-700 hover:bg-gray-100" : "bg-primary text-white"
                }`}
              >
                All Brands
              </button>
              {BRAND_OPTIONS.map((brand) => (
                <button
                  key={brand}
                  onClick={() => setFilter("brand", filters.brand === brand ? null : brand)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                    filters.brand === brand ? "bg-primary text-white" : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {brand}
                </button>
              ))}
            </div>
          </FilterSection>

          {/* Color */}
          <FilterSection title="Color" isActive={!!filters.color} defaultOpen={false}>
            <div className="flex flex-wrap gap-2 pt-1">
              {COLOR_OPTIONS.map(({ name, hex }) => (
                <button
                  key={name}
                  onClick={() => setFilter("color", filters.color === name ? null : name)}
                  title={name}
                  aria-label={name}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    filters.color === name
                      ? "border-primary scale-110 ring-2 ring-primary/30"
                      : "border-gray-200 hover:border-gray-400"
                  }`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
            {filters.color && (
              <button
                onClick={() => setFilter("color", null)}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Clear color
              </button>
            )}
          </FilterSection>

          {/* Size */}
          <FilterSection title="Size" isActive={!!filters.size} defaultOpen={false}>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SIZE_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter("size", filters.size === s ? null : s)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                    filters.size === s
                      ? "bg-primary text-white border-primary"
                      : "border-gray-200 text-gray-700 hover:border-primary hover:text-primary"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </FilterSection>

          {/* Discount */}
          <FilterSection title="Discount" isActive={!!filters.minDiscount} defaultOpen={false}>
            <div className="space-y-0.5">
              {[null, 10, 20, 30, 50].map((pct) => (
                <button
                  key={pct ?? "all"}
                  onClick={() => setFilter("minDiscount", pct)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                    filters.minDiscount === pct
                      ? "bg-primary text-white"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {pct === null ? "All discounts" : `${pct}% off or more`}
                </button>
              ))}
            </div>
          </FilterSection>
        </div>
      </aside>
    </>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────
function PaginationRow({ pagination, currentPage, onPageChange }) {
  if (pagination.pages <= 1) return null;
  return (
    <div className="flex justify-center items-center gap-2">
      <button
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage <= 1}
        className="w-10 h-10 flex items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors bg-white"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      {Array.from({ length: Math.min(7, pagination.pages) }, (_, i) => {
        const p = pagination.pages <= 7 ? i + 1 : i + Math.max(1, Math.min(currentPage - 3, pagination.pages - 6));
        if (p < 1 || p > pagination.pages) return null;
        return (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`w-10 h-10 flex items-center justify-center rounded-xl text-sm font-semibold transition-colors ${currentPage === p ? "bg-primary text-white shadow-sm" : "border border-gray-200 text-gray-700 hover:border-primary hover:text-primary bg-white"}`}
          >
            {p}
          </button>
        );
      })}
      <button
        onClick={() => onPageChange(Math.min(pagination.pages, currentPage + 1))}
        disabled={currentPage >= pagination.pages}
        className="w-10 h-10 flex items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors bg-white"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
function ShopContent() {
  const router   = useRouter();
  const pathname = usePathname();
  const sp       = useSearchParams();
  const addItem  = useCartStore((s) => s.addItem);
  const wishlist = useUIStore((s) => s.wishlist);
  const addToWishlist    = useUIStore((s) => s.addToWishlist);
  const removeFromWishlist = useUIStore((s) => s.removeFromWishlist);

  const [quickViewProduct, setQuickViewProduct] = useState(null);
  const [compareIds,       setCompareIds]       = useState([]);
  const [showCompare,      setShowCompare]       = useState(false);

  const handleToggleCompare = useCallback((product) => {
    setCompareIds((prev) => {
      if (prev.includes(product.id)) return prev.filter((id) => id !== product.id);
      if (prev.length >= 4) { toast.error("You can compare up to 4 products"); return prev; }
      return [...prev, product.id];
    });
  }, []);

  const [filters, setFiltersState] = useState({
    category:  sp.get("category")   || null,
    search:    sp.get("q")          || "",
    minPrice:  sp.get("min_price") ? Number(sp.get("min_price")) : null,
    maxPrice:  sp.get("max_price") ? Number(sp.get("max_price")) : null,
    minRating: sp.get("min_rating") ? Number(sp.get("min_rating")) : null,
    condition: sp.get("condition")  || null,
    delivery:  sp.get("delivery")   || null,
    brand:     sp.get("brand")      || null,
    color:     sp.get("color")      || null,
    size:         sp.get("size")          || null,
    verifiedOnly: sp.get("verified_only") === "true",
    minDiscount:  sp.get("min_discount") ? Number(sp.get("min_discount")) : null,
    sort:         sp.get("sort")          || (sp.get("q") ? "relevance" : "popular"),
    page:         sp.get("page") ? Number(sp.get("page")) : 1,
  });
  const [view, setView]               = useState("grid");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Tracks the last URL string this component set via router.replace.
  // Used to distinguish our own URL updates from external navigation (navbar links).
  const lastSetUrlRef = useRef("");

  const setFilter = useCallback((key, value) => {
    setFiltersState((prev) => {
      const next = { ...prev, [key]: value };
      if (key !== "page") next.page = 1;
      return next;
    });
  }, []);

  // The search box is uncontrolled by `filters` while the shopper is typing.
  // Committing on every keystroke fired a request (and a router.replace) per
  // character. Debounced at 280ms, matching the navbar's autocomplete.
  const [searchDraft, setSearchDraft] = useState(filters.search);

  // External navigation (navbar search, chip removal, "clear filters") must
  // reach the input. Adjusted during render rather than in an effect, so it
  // costs no extra commit — see react.dev "You Might Not Need an Effect".
  const [syncedSearch, setSyncedSearch] = useState(filters.search);
  if (filters.search !== syncedSearch) {
    setSyncedSearch(filters.search);
    setSearchDraft(filters.search);
  }

  // Typing -> filters. No-ops once they agree, so the sync above cannot bounce
  // the value back mid-keystroke.
  useEffect(() => {
    if (searchDraft === filters.search) return;
    const t = setTimeout(() => setFilter("search", searchDraft), 280);
    return () => clearTimeout(t);
  }, [searchDraft, filters.search, setFilter]);

  // Sync filters → URL (internal filter changes)
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.category)  params.set("category",   filters.category);
    if (filters.search)    params.set("q",           filters.search);
    if (filters.minPrice)  params.set("min_price",   filters.minPrice);
    if (filters.maxPrice)  params.set("max_price",   filters.maxPrice);
    if (filters.minRating) params.set("min_rating",  filters.minRating);
    if (filters.condition) params.set("condition",   filters.condition);
    if (filters.delivery)  params.set("delivery",    filters.delivery);
    if (filters.brand)     params.set("brand",       filters.brand);
    if (filters.color)        params.set("color",          filters.color);
    if (filters.size)         params.set("size",           filters.size);
    if (filters.verifiedOnly) params.set("verified_only",  "true");
    if (filters.minDiscount)  params.set("min_discount",   filters.minDiscount);
    if (filters.sort !== "popular") params.set("sort",     filters.sort);
    if (filters.page > 1)  params.set("page",        filters.page);
    const newSearch = params.toString();
    lastSetUrlRef.current = newSearch;
    router.replace(`${pathname}?${newSearch}`, { scroll: false });
  }, [filters, pathname, router]);

  // Sync URL → filters (external navigation e.g. navbar category links).
  // Skipped when sp changed because of our own router.replace above.
  useEffect(() => {
    if (sp.toString() === lastSetUrlRef.current) return; // our own update — ignore
    setFiltersState({
      category:     sp.get("category")      || null,
      search:       sp.get("q")             || "",
      minPrice:     sp.get("min_price")     ? Number(sp.get("min_price"))    : null,
      maxPrice:     sp.get("max_price")     ? Number(sp.get("max_price"))    : null,
      minRating:    sp.get("min_rating")    ? Number(sp.get("min_rating"))   : null,
      condition:    sp.get("condition")     || null,
      delivery:     sp.get("delivery")      || null,
      brand:        sp.get("brand")         || null,
      color:        sp.get("color")         || null,
      size:         sp.get("size")          || null,
      verifiedOnly: sp.get("verified_only") === "true",
      minDiscount:  sp.get("min_discount")  ? Number(sp.get("min_discount")) : null,
      sort:         sp.get("sort")          || (sp.get("q") ? "relevance" : "popular"),
      page:         sp.get("page")          ? Number(sp.get("page"))         : 1,
    });
  }, [sp]);

  const { data: productsData, isLoading, isError } = useQuery({
    queryKey: ["products", filters],
    queryFn: () => fetchProducts({
      category:      filters.category,
      search:        filters.search,
      min_price:     filters.minPrice,
      max_price:     filters.maxPrice,
      min_rating:    filters.minRating,
      condition:     filters.condition,
      color:         filters.color,
      size:          filters.size,
      brand:         filters.brand,
      delivery:      filters.delivery,
      verified_only: filters.verifiedOnly ? "true" : undefined,
      min_discount:  filters.minDiscount,
      sort:          filters.sort,
      page:          filters.page,
      per_page:      PER_PAGE,
    }),
    staleTime: 30_000,
  });

  const { categories, parents, subsByParent } = useCategories();

  const products   = productsData?.products ?? [];
  const pagination = productsData?.pagination ?? { total: 0, pages: 1, page: 1 };

  // `relaxed`: no exact match existed, so the API widened the query rather than
  // returning a dead end. `didYouMean`: nearest catalogue term when nothing matched.
  const relaxed    = Boolean(productsData?.relaxed) && Boolean(filters.search);
  const didYouMean = productsData?.didYouMean ?? null;

  const compareProducts = products.filter((p) => compareIds.includes(p.id));

  const activeFilters = [
    filters.category  && { key: "category",  label: categories.find((c) => c.slug === filters.category)?.name ?? filters.category },
    filters.search    && { key: "search",    label: `"${filters.search}"` },
    (filters.minPrice !== null || filters.maxPrice !== null) && {
      key: "price",
      label: filters.minPrice && filters.maxPrice
        ? `₦${filters.minPrice.toLocaleString()} – ₦${filters.maxPrice.toLocaleString()}`
        : filters.minPrice ? `Above ₦${filters.minPrice.toLocaleString()}`
        : `Under ₦${filters.maxPrice?.toLocaleString()}`,
    },
    filters.minRating && { key: "minRating", label: `${filters.minRating}+ stars` },
    filters.condition && { key: "condition", label: filters.condition },
    filters.delivery  && { key: "delivery",  label: filters.delivery },
    filters.brand     && { key: "brand",     label: filters.brand },
    filters.color        && { key: "color",        label: filters.color },
    filters.size         && { key: "size",         label: `Size: ${filters.size}` },
    filters.verifiedOnly && { key: "verifiedOnly", label: "Verified Sellers" },
    filters.minDiscount  && { key: "minDiscount",  label: `${filters.minDiscount}%+ off` },
  ].filter(Boolean);

  const clearFilter = (key) => {
    if (key === "price") { setFilter("minPrice", null); setFilter("maxPrice", null); }
    else if (key === "verifiedOnly") setFilter("verifiedOnly", false);
    else setFilter(key, null);
  };

  const handleAddToCart = (product) => {
    addItem({ productId: product.id, vendorId: product.vendor?.id ?? null, name: product.name, price: product.salePrice ?? product.price, image: product.image, quantity: 1 });
    toast.success(`${product.name} added to cart`);
  };

  const handleToggleWishlist = (product) => {
    const inWishlist = wishlist.some((w) => w === product.id || w?.id === product.id);
    if (inWishlist) { removeFromWishlist(product.id); toast.success("Removed from wishlist"); }
    else { addToWishlist(product); toast.success("Added to wishlist"); }
  };

  const currentCategory = categories.find((c) => c.slug === filters.category);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Quick View */}
      <AnimatePresence>
        {quickViewProduct && (
          <QuickViewModal
            product={quickViewProduct}
            onClose={() => setQuickViewProduct(null)}
            onAddToCart={handleAddToCart}
            onToggleWishlist={handleToggleWishlist}
            inWishlist={wishlist.some((w) => w === quickViewProduct.id || w?.id === quickViewProduct.id)}
          />
        )}
      </AnimatePresence>

      {/* Compare Modal */}
      <AnimatePresence>
        {showCompare && compareProducts.length >= 2 && (
          <CompareModal products={compareProducts} onClose={() => setShowCompare(false)} />
        )}
      </AnimatePresence>

      {/* Compare Sticky Bar */}
      <AnimatePresence>
        {compareIds.length >= 2 && !showCompare && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-20 sm:bottom-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-4"
          >
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-accent" />
              <span className="text-sm font-semibold">{compareIds.length} products selected</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCompare(true)}
                className="bg-primary text-white text-xs font-bold px-4 py-1.5 rounded-full hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                Compare Now
              </button>
              <button
                onClick={() => setCompareIds([])}
                className="text-gray-400 hover:text-white transition-colors p-1"
                aria-label="Clear compare"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Shop header banner ───────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-xs text-gray-500 mb-3">
            <Link href="/" className="hover:text-primary transition-colors flex items-center gap-1">
              <Home className="w-3.5 h-3.5" /> Home
            </Link>
            <Chevron className="w-3 h-3" />
            <Link href="/shop" className={`hover:text-primary transition-colors ${filters.category ? "" : "text-gray-900 font-medium"}`}>
              Shop
            </Link>
            {currentCategory && (
              <>
                <Chevron className="w-3 h-3" />
                <span className="text-gray-900 font-medium">{currentCategory.name}</span>
              </>
            )}
          </nav>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
                {currentCategory?.name ?? "Shop All Products"}
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {isLoading ? "Loading…" : `${pagination.total.toLocaleString()} products found`}
              </p>
            </div>
            {/* Search */}
            <div className="relative max-w-xs w-full sm:w-auto">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Search products…"
                className="w-full pl-10 pr-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              {searchDraft && (
                <button
                  onClick={() => { setSearchDraft(""); setFilter("search", ""); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex gap-6">
          {/* Sidebar */}
          <FilterSidebar
            filters={filters}
            setFilter={setFilter}
            parents={parents}
            subsByParent={subsByParent}
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />

          {/* Main */}
          <div className="flex-1 min-w-0">
            {/* Toolbar */}
            {/* Row 1: filter toggle + sort + view toggle */}
            <div className="flex items-center gap-2 mb-3">
              {/* Mobile filter toggle */}
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden flex items-center gap-1.5 px-3 py-2 text-sm font-semibold border border-gray-200 rounded-xl text-gray-700 hover:border-primary bg-white shrink-0"
              >
                <Filter className="w-4 h-4" /> Filters
                {activeFilters.length > 0 && (
                  <span className="w-5 h-5 bg-primary text-white text-xs rounded-full flex items-center justify-center font-bold">
                    {activeFilters.length}
                  </span>
                )}
              </button>

              {/* Sort — visible on all screen sizes */}
              <div className="relative flex-1 sm:flex-none">
                <select
                  value={filters.sort}
                  onChange={(e) => setFilter("sort", e.target.value)}
                  className="w-full sm:w-auto appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/15 bg-white font-medium text-gray-700 cursor-pointer"
                >
                  {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>

              {/* View toggle */}
              <div className="flex items-center bg-white border border-gray-200 rounded-xl overflow-hidden shrink-0 ml-auto sm:ml-0">
                <button onClick={() => setView("grid")} className={`p-2.5 transition-colors ${view === "grid" ? "bg-primary text-white" : "text-gray-500 hover:bg-gray-50"}`}>
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button onClick={() => setView("list")} className={`p-2.5 transition-colors ${view === "list" ? "bg-primary text-white" : "text-gray-500 hover:bg-gray-50"}`}>
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Row 2: active filter chips */}
            {activeFilters.length > 0 && (
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {activeFilters.map((f) => (
                  <span key={f.key} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-primary/10 text-primary rounded-full">
                    {f.label}
                    <button onClick={() => clearFilter(f.key)} className="hover:opacity-70">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {activeFilters.length > 1 && (
                  <button
                    onClick={() => setFiltersState({ category: null, search: "", minPrice: null, maxPrice: null, minRating: null, condition: null, delivery: null, brand: null, color: null, size: null, verifiedOnly: false, minDiscount: null, sort: "popular", page: 1 })}
                    className="text-xs font-semibold text-gray-500 hover:text-red-500 underline"
                  >
                    Clear all
                  </button>
                )}
              </div>
            )}

            {/* Top pagination (desktop only, when enough products) */}
            {!isLoading && pagination.pages > 1 && (
              <div className="hidden lg:flex justify-between items-center mb-4">
                <p className="text-sm text-gray-500">
                  Showing {((filters.page - 1) * PER_PAGE) + 1}–{Math.min(filters.page * PER_PAGE, pagination.total)} of {pagination.total.toLocaleString()} products
                </p>
                <PaginationRow pagination={pagination} currentPage={filters.page} onPageChange={(p) => setFilter("page", p)} />
              </div>
            )}

            {/* Nothing matched exactly — say so rather than pretending these are exact hits */}
            {!isLoading && !isError && relaxed && products.length > 0 && (
              <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
                <Search className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-900">
                  No exact matches for <span className="font-semibold">“{filters.search}”</span>
                  {didYouMean && (
                    <>
                      {" — did you mean "}
                      <button
                        onClick={() => { setSearchDraft(didYouMean); setFilter("search", didYouMean); }}
                        className="font-semibold underline underline-offset-2 hover:opacity-70"
                      >
                        {didYouMean}
                      </button>
                      ?
                    </>
                  )}
                  {" "}Showing the closest products we could find.
                </p>
              </div>
            )}

            {/* Loading skeleton */}
            {isLoading && (
              <div className={view === "grid" ? "grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4" : "space-y-4"}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className={`bg-white rounded-2xl border border-gray-100 overflow-hidden animate-pulse ${view === "grid" ? "" : "flex gap-4 p-4"}`}>
                    <div className={view === "grid" ? "aspect-square bg-gray-200" : "w-32 h-32 bg-gray-200 rounded-xl shrink-0"} />
                    <div className={`p-4 space-y-2 ${view === "list" ? "flex-1" : ""}`}>
                      <div className="h-3 bg-gray-200 rounded w-3/4" />
                      <div className="h-3 bg-gray-200 rounded w-1/2" />
                      <div className="h-4 bg-gray-200 rounded w-1/3 mt-3" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Error */}
            {isError && (
              <div className="text-center py-16">
                <p className="text-gray-500 mb-4">Failed to load products.</p>
                <button onClick={() => window.location.reload()} className="px-5 py-2.5 bg-primary text-white rounded-full text-sm font-bold hover:opacity-90">Retry</button>
              </div>
            )}

            {/* Empty */}
            {!isLoading && !isError && products.length === 0 && (
              <div className="text-center py-20">
                <ShoppingCart className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                <h3 className="font-bold text-gray-900 mb-1">
                  {filters.search ? `No results for “${filters.search}”` : "No products found"}
                </h3>

                {/* Offer the nearest catalogue term instead of a dead end. */}
                {didYouMean ? (
                  <p className="text-sm text-gray-500 mb-5">
                    Did you mean{" "}
                    <button
                      onClick={() => { setSearchDraft(didYouMean); setFilter("search", didYouMean); }}
                      className="font-semibold text-primary hover:underline"
                    >
                      {didYouMean}
                    </button>
                    ?
                  </p>
                ) : (
                  <p className="text-sm text-gray-500 mb-5">Try adjusting your filters or search term.</p>
                )}

                <button
                  onClick={() => { setSearchDraft(""); setFiltersState({ category: null, search: "", minPrice: null, maxPrice: null, minRating: null, condition: null, delivery: null, brand: null, color: null, size: null, verifiedOnly: false, minDiscount: null, sort: "popular", page: 1 }); }}
                  className="px-6 py-2.5 bg-primary text-white rounded-full text-sm font-bold hover:opacity-90 transition-opacity"
                >
                  Clear Filters
                </button>
              </div>
            )}

            {/* Products */}
            {!isLoading && !isError && products.length > 0 && (
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${filters.category}-${filters.sort}-${filters.page}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={view === "grid"
                    ? "grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4"
                    : "space-y-3"
                  }
                >
                  {products.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      view={view}
                      onAddToCart={handleAddToCart}
                      onToggleWishlist={handleToggleWishlist}
                      inWishlist={wishlist.some((w) => w === product.id || w?.id === product.id)}
                      onQuickView={setQuickViewProduct}
                      onCompare={view === "grid" ? handleToggleCompare : null}
                      inCompare={compareIds.includes(product.id)}
                    />
                  ))}
                </motion.div>
              </AnimatePresence>
            )}

            {/* Bottom Pagination */}
            {!isLoading && pagination.pages > 1 && (
              <div className="mt-10">
                <PaginationRow pagination={pagination} currentPage={filters.page} onPageChange={(p) => setFilter("page", p)} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ShopPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <ShopContent />
    </Suspense>
  );
}
