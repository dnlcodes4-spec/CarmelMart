"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Script from "next/script";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin,
  CreditCard,
  Truck,
  ChevronRight,
  CheckCircle,
  ShieldCheck,
  Phone,
  User,
  Home,
  Landmark,
  Tag,
  X,
  Mail,
  UserCircle,
  Download,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useCartStore } from "@/store/cartStore";
import { useUIStore } from "@/store/uiStore";
import { useAuth } from "@/lib/auth-context";
import { formatNigerianPhone } from "@/lib/utils";
import StateLgaPicker from "@/components/ui/StateLgaPicker";
import MapPickupPicker from "@/components/shared/MapPickupPicker";
import { stateCentre } from "@/lib/geo/nigeria";

const DELIVERY_FALLBACK = [
  { id: "standard", label: "Standard Delivery", duration: "3–7 business days", fee: 1500 },
  { id: "express",  label: "Express Delivery",  duration: "1–2 business days", fee: 3500 },
];

const PAYMENT_METHODS = [
  { id: "flutterwave", label: "Card / Bank Transfer / USSD", icon: CreditCard, sub: "Powered by Flutterwave" },
];

const STEPS_PHYSICAL = ["Address", "Delivery", "Payment", "Review"];
const STEPS_DIGITAL  = ["Contact",  "Payment",  "Review"];

// ─── Step indicator ────────────────────────────────────────────────────────────
function StepBar({ steps, current }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-6 sm:mb-10">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center">
          <div className="flex flex-col items-center">
            <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold transition-colors ${
              i < current ? "bg-green-500 text-white" :
              i === current ? "bg-primary text-white" :
              "bg-gray-200 text-gray-500"
            }`}>
              {i < current ? <CheckCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : i + 1}
            </div>
            <span className={`text-[10px] sm:text-xs mt-1 font-medium ${i === current ? "text-primary" : "text-gray-400"}`}>
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 w-8 sm:w-20 mb-4 mx-1 transition-colors ${i < current ? "bg-green-500" : "bg-gray-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Field helper ─────────────────────────────────────────────────────────────
function Field({ label, required, children, hint }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

const PENDING_CHECKOUT_KEY = "cm_pending_checkout";

// ─── Main component ────────────────────────────────────────────────────────────
export default function CheckoutPage() {
  const router = useRouter();
  const { user, isGuest } = useAuth();
  const items  = useCartStore((s) => s.items);
  const total  = useCartStore((s) => s.items.reduce((sum, i) => sum + i.price * i.quantity, 0));
  const clearCart = useCartStore((s) => s.clearCart);

  // True when every item in the cart is being purchased as a digital download
  const isAllDigital = items.length > 0 && items.every((i) => i.deliveryFormat === "digital");
  const STEPS = isAllDigital ? STEPS_DIGITAL : STEPS_PHYSICAL;
  const savedDeliveryState = useUIStore((s) => s.deliveryLocation);

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  // Recovery state: detects a payment that was charged but order never created
  const [recoveryData, setRecoveryData] = useState(null); // { txRef, payload }
  const [recovering, setRecovering] = useState(false);
  // true when Flutterwave has received a bank transfer but it hasn't settled yet
  const [recoveryPending, setRecoveryPending] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PENDING_CHECKOUT_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      // Only surface recoveries from the last 24 h — older ones are stale
      if (parsed?.txRef && Date.now() - (parsed.savedAt ?? 0) < 24 * 60 * 60 * 1000) {
        // Intentionally set post-mount (not via a lazy useState initializer):
        // reading localStorage during render would cause an SSR hydration
        // mismatch on the recovery banner.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRecoveryData(parsed);
      } else {
        localStorage.removeItem(PENDING_CHECKOUT_KEY);
      }
    } catch {
      localStorage.removeItem(PENDING_CHECKOUT_KEY);
    }
  }, []);

  const dismissRecovery = useCallback(() => {
    localStorage.removeItem(PENDING_CHECKOUT_KEY);
    setRecoveryData(null);
    setRecoveryPending(false);
  }, []);

  const attemptRecovery = useCallback(async () => {
    if (!recoveryData) return;
    setRecovering(true);
    setRecoveryPending(false);
    try {
      const res = await fetch("/api/customer/orders/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txRef: recoveryData.txRef, transactionId: recoveryData.transactionId ?? null, payload: recoveryData.payload }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.removeItem(PENDING_CHECKOUT_KEY);
        clearCart();
        router.push(`/checkout/success?order_id=${data.order_id}`);
      } else if (data.pending) {
        // Bank transfer received by Flutterwave but not yet settled — keep the
        // banner, show a "check again" state so the user isn't misled.
        setRecoveryPending(true);
      } else if (data.not_found) {
        // No transaction on Flutterwave's side at all. Could mean the bank
        // transfer hasn't reached them yet OR the user never paid. Keep the
        // banner so they can retry — don't tell them definitively they weren't
        // charged since a slow transfer could still arrive.
        toast("No payment found yet. If you completed your transfer, please wait a few minutes and try again.", { icon: "ℹ️" });
      } else {
        toast.error(data.error ?? "Recovery failed. Please contact support.");
      }
    } catch {
      toast.error("Could not check payment status. Please try again.");
    }
    setRecovering(false);
  }, [recoveryData, clearCart, router]);

  const [promoInput, setPromoInput] = useState("");
  const [promoValidating, setPromoValidating] = useState(false);
  const [appliedPromo, setAppliedPromo] = useState(null); // { promoId, code, discount, description }

  const [address, setAddress] = useState({
    fullName: user?.first_name ? `${user.first_name} ${user.last_name ?? ""}`.trim() : "",
    phone: "",
    email: user?.email ?? "",
    houseNumber: "",
    street: "",
    landmark: "",
    area: "",
    city: "",
    state: savedDeliveryState ?? "",
    lga: "",
    deliveryInstructions: "",
    lat: null,
    lng: null,
  });

  const [delivery, setDelivery] = useState("standard");
  const [payment, setPayment] = useState("flutterwave");

  // Fetch delivery zones for the selected state
  const { data: zoneData } = useQuery({
    queryKey: ["delivery-zones", address.state],
    queryFn: () => fetch(`/api/delivery-zones?state=${encodeURIComponent(address.state)}`).then((r) => r.json()),
    enabled: !!address.state,
    staleTime: 10 * 60 * 1000,
  });

  // Build delivery options with real fees when zone data is available
  const DELIVERY_OPTIONS = useMemo(() => {
    const zones = zoneData?.zones ?? [];
    const zone  = zones.find((z) => !z.lga || z.lga.trim() === "") ?? zones[0];
    if (!zone) return DELIVERY_FALLBACK;
    const days       = zone.estimated_days ?? "3–7";
    const baseFee    = zone.base_fee ?? 1500;
    const expressFee = Math.round(baseFee * 2);
    return [
      { id: "standard", label: "Standard Delivery", duration: `${days} business days`, fee: baseFee    },
      { id: "express",  label: "Express Delivery",  duration: "1–2 business days",     fee: expressFee },
    ];
  }, [zoneData]);

  // Fast Link live shipping quote (per-vendor, summed). Runs once we have
  // destination coordinates; degrades to the zone-based fee on any fallback.
  const cartKey = items.map((i) => `${i.vendorId}:${i.quantity}`).join(",");
  const canQuote = !isAllDigital && address.lat != null && address.lng != null && items.length > 0;
  const { data: flQuote, isFetching: quoteLoading } = useQuery({
    queryKey: ["shipping-quote", address.lat, address.lng, cartKey],
    queryFn: () =>
      fetch("/api/checkout/shipping-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: { lat: address.lat, lng: address.lng },
          items: items.map((i) => ({ vendorId: i.vendorId, quantity: i.quantity })),
        }),
      }).then((r) => r.json()),
    enabled: canQuote,
    staleTime: 5 * 60 * 1000,
  });

  // Use the Fast Link fee only when the whole cart was priced; else zone fee.
  const flFee = flQuote?.ok && flQuote.fallback === false ? flQuote.totalFee : null;
  const zoneFee = DELIVERY_OPTIONS.find((o) => o.id === delivery)?.fee ?? 1500;
  const deliveryFee = isAllDigital ? 0 : (flFee ?? zoneFee);
  const discount = appliedPromo?.discount ?? 0;
  const discountedSubtotal = Math.max(0, total - discount);
  const grandTotal = discountedSubtotal + deliveryFee;
  const amountDue = grandTotal;

  const applyPromo = async () => {
    if (!promoInput.trim()) return;
    setPromoValidating(true);
    try {
      const res = await fetch("/api/promo/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: promoInput.trim(), order_total: total }),
      });
      const data = await res.json();
      if (data.valid) {
        setAppliedPromo({ promoId: data.promoId, code: data.code, discount: data.discount, description: data.description });
        toast.success(`Promo applied: ${data.description}`);
        setPromoInput("");
      } else {
        toast.error(data.error ?? "Invalid promo code");
      }
    } catch {
      toast.error("Could not validate promo code");
    }
    setPromoValidating(false);
  };

  const removePromo = () => {
    setAppliedPromo(null);
    toast("Promo code removed");
  };

  // ── Validation ───────────────────────────────────────────────────────────────
  const validateAddress = () => {
    if (isAllDigital) {
      // Digital only needs name + email for the receipt
      if (!address.fullName.trim()) { toast.error("Please enter your name"); return false; }
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email);
      if (!emailOk) { toast.error("Please enter a valid email address"); return false; }
      return true;
    }
    const required = ["fullName", "phone", "street", "landmark", "city", "state", "lga"];
    if (isGuest) required.push("email");
    const missing = required.filter((f) => !address[f].trim());
    if (missing.length) {
      toast.error("Please fill in all required fields");
      return false;
    }
    const phoneClean = address.phone.replace(/\s/g, "");
    if (!/^(\+234|0)[789]\d{9}$/.test(phoneClean)) {
      toast.error("Enter a valid Nigerian phone number");
      return false;
    }
    return true;
  };

  // Map visual step → logical step index accounting for the skipped Delivery step
  const next = () => {
    if (step === 0 && !validateAddress()) return;
    setStep((s) => s + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const back = () => {
    setStep((s) => s - 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── Order creation ────────────────────────────────────────────────────────────
  const createOrder = async ({ paymentRef, paymentTransactionId }) => {
    const res = await fetch("/api/customer/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: items.map((i) => ({
          productId:          i.productId,
          vendorId:           i.vendorId,
          name:               i.name,
          price:              i.price,
          quantity:           i.quantity,
          image:              i.image ?? null,
          delivery_format:    i.deliveryFormat ?? "physical",
          variantId:          i.variantId ?? null,
          variantCombination: i.variantCombination ?? null,
        })),
        delivery_address: isAllDigital ? {
          fullName:      address.fullName,
          email:         address.email,
          delivery_method: "digital",
          delivery_fee:  0,
        } : {
          fullName:               address.fullName,
          phone:                  address.phone,
          houseNumber:            address.houseNumber,
          street:                 address.street,
          landmark:               address.landmark,
          area:                   address.area,
          city:                   address.city,
          lga:                    address.lga,
          state:                  address.state,
          delivery_instructions:  address.deliveryInstructions,
          delivery_method:        delivery,
          delivery_fee:           deliveryFee,
          lat:                    address.lat,
          lng:                    address.lng,
          coordinates:            address.lat != null && address.lng != null ? `${address.lat},${address.lng}` : null,
        },
        is_all_digital: isAllDigital,
        payment_method: "card",
        payment_ref:    paymentRef ?? null,
        payment_transaction_id: paymentTransactionId ?? null,
        promo_id:       appliedPromo?.promoId ?? null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not create order");
    return data.order_id;
  };

  // ── Flutterwave payment ───────────────────────────────────────────────────────
  const initiateFlutterwave = () => {
    const publicKey = process.env.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY;
    if (!publicKey || typeof window.FlutterwaveCheckout === "undefined") {
      setLoading(false);
      toast.error("Payment gateway not available. Please try again.");
      return;
    }

    const txRef = `CM-FLW-${Date.now()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;

    // Save payment intent to localStorage BEFORE opening the popup.
    // If the browser crashes or the tab closes after Flutterwave charges the user
    // but before the JS callback fires, this record lets us recover the order
    // when the user returns to the site.
    const pendingPayload = {
      items: items.map((i) => ({
        productId:          i.productId,
        vendorId:           i.vendorId,
        quantity:           i.quantity,
        delivery_format:    i.deliveryFormat ?? "physical",
        variantId:          i.variantId ?? null,
        variantCombination: i.variantCombination ?? null,
      })),
      delivery_address: isAllDigital ? {
        fullName:        address.fullName,
        email:           address.email,
        delivery_method: "digital",
        delivery_fee:    0,
      } : {
        fullName:              address.fullName,
        phone:                 address.phone,
        houseNumber:           address.houseNumber,
        street:                address.street,
        landmark:              address.landmark,
        area:                  address.area,
        city:                  address.city,
        lga:                   address.lga,
        state:                 address.state,
        delivery_instructions: address.deliveryInstructions,
        delivery_method:       delivery,
        delivery_fee:          deliveryFee,
        email:                 address.email,
        lat:                   address.lat,
        lng:                   address.lng,
        coordinates:           address.lat != null && address.lng != null ? `${address.lat},${address.lng}` : null,
      },
      is_all_digital: isAllDigital,
      payment_method: "card",
      promo_id:       appliedPromo?.promoId ?? null,
    };

    try {
      localStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify({
        txRef,
        payload:  pendingPayload,
        savedAt:  Date.now(),
      }));
    } catch {
      // localStorage unavailable (private mode quota) — proceed without recovery safety-net
    }

    window.FlutterwaveCheckout({
      public_key: publicKey,
      tx_ref: txRef,
      amount: amountDue,
      currency: "NGN",
      payment_options: "card,ussd,banktransfer",
      customer: {
        email: address.email,
        phone_number: address.phone,
        name: address.fullName,
      },
      customizations: {
        title: "CarmelMart",
        description: "Order payment",
        logo: `${window.location.origin}/logo-black.png`,
      },
      callback: async (response) => {
        if (response.status === "successful") {
          // Persist transactionId immediately — before any async ops that could crash.
          // Recovery endpoint uses this to verify via the direct API instead of the slower list API.
          try {
            const saved = JSON.parse(localStorage.getItem(PENDING_CHECKOUT_KEY) ?? "null");
            if (saved) {
              localStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify({
                ...saved,
                transactionId: response.transaction_id,
              }));
            }
          } catch { /* ignore — private mode / quota */ }
          try {
            // 1. Verify payment with Flutterwave
            const verifyRes = await fetch("/api/flutterwave/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transaction_id: response.transaction_id }),
            });
            const verifyData = await verifyRes.json();
            if (!verifyData.success) {
              toast.error("Payment verification failed. Contact support.");
              return;
            }
            // 2. Create the order in the database
            const orderId = await createOrder({
              paymentRef: txRef,
              paymentTransactionId: response.transaction_id,
            });
            // Clear the pending recovery record — order was created successfully
            localStorage.removeItem(PENDING_CHECKOUT_KEY);
            clearCart();
            router.push(`/checkout/success?order_id=${orderId}`);
          } catch (err) {
            toast.error(err.message || "Could not place order. Contact support.");
          }
        } else {
          // Payment not completed — clear the recovery record (user didn't pay)
          localStorage.removeItem(PENDING_CHECKOUT_KEY);
          toast.error("Payment was not completed.");
        }
      },
      onclose: () => {
        setLoading(false);
      },
    });
  };

  const handlePlaceOrder = () => {
    setLoading(true);
    initiateFlutterwave();
    // loading is reset in onclose / callback — do not call setLoading(false) here
  };

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold text-gray-900 mb-3">Your cart is empty</h2>
          <Link href="/shop" className="text-primary font-semibold hover:underline">Browse products</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Flutterwave SDK — must use next/script, not plain <script>, to execute on client-side navigation */}
      <Script src="https://checkout.flutterwave.com/v3.js" strategy="lazyOnload" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-10">
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-5">Checkout</h1>

        {/* Payment recovery banner — shown when a previous payment was charged but the order was never created */}
        {recoveryData && (
          <div className={`flex items-start justify-between gap-3 rounded-xl px-4 py-3 mb-6 text-sm border ${
            recoveryPending
              ? "bg-amber-50 border-amber-200"
              : "bg-red-50 border-red-200"
          }`}>
            <div className={`flex items-start gap-2 ${recoveryPending ? "text-amber-800" : "text-red-800"}`}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                {recoveryPending ? (
                  <>
                    <p className="font-semibold">Your bank transfer is being processed</p>
                    <p className="text-xs mt-0.5 text-amber-700">
                      We received your transfer. It usually clears within a few minutes.
                      Click below to check if it has settled and create your order.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">Incomplete payment detected</p>
                    <p className="text-xs mt-0.5 text-red-700">
                      A previous payment may have been charged but your order was not confirmed.
                      Click below to check its status — this is safe to retry.
                    </p>
                  </>
                )}
                <button
                  onClick={attemptRecovery}
                  disabled={recovering}
                  className={`mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60 ${
                    recoveryPending ? "bg-amber-600 hover:bg-amber-700" : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  <RefreshCw className={`w-3 h-3 ${recovering ? "animate-spin" : ""}`} />
                  {recovering ? "Checking…" : recoveryPending ? "Check again" : "Recover my order"}
                </button>
              </div>
            </div>
            <button
              onClick={dismissRecovery}
              className={`transition-colors shrink-0 mt-0.5 ${recoveryPending ? "text-amber-400 hover:text-amber-600" : "text-red-400 hover:text-red-600"}`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Guest session notice */}
        {isGuest && (
          <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 text-sm">
            <div className="flex items-center gap-2 text-amber-800">
              <UserCircle className="w-4 h-4 shrink-0" />
              <span>Checking out as guest. <Link href="/convert-account" className="font-semibold underline underline-offset-2">Create an account</Link> after checkout to track all your orders.</span>
            </div>
          </div>
        )}

        <StepBar steps={STEPS} current={step} />

        <div className="grid lg:grid-cols-5 gap-8">
          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="lg:col-span-3">
            <AnimatePresence mode="wait">
              {/* STEP 0 — Contact (digital) or Address (physical) */}
              {step === 0 && isAllDigital && (
                <motion.div key="contact" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                  className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Download className="w-5 h-5 text-primary" />
                    <h2 className="font-bold text-gray-900">Contact Details</h2>
                  </div>
                  <p className="text-sm text-gray-500">Your download links will be sent to this email immediately after payment.</p>
                  <div className="space-y-4">
                    <Field label="Full Name" required>
                      <input value={address.fullName} onChange={(e) => setAddress({ ...address, fullName: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none text-sm"
                        placeholder="Adebayo Johnson" />
                    </Field>
                    <Field label="Email Address" required hint="Download links are sent here">
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input type="email" value={address.email} onChange={(e) => setAddress({ ...address, email: e.target.value })}
                          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none text-sm"
                          placeholder="you@example.com" />
                      </div>
                    </Field>
                  </div>
                  <button onClick={next}
                    className="w-full py-3.5 bg-primary text-white font-bold rounded-2xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2 mt-2">
                    Continue to Payment <ChevronRight className="w-4 h-4" />
                  </button>
                </motion.div>
              )}

              {step === 0 && !isAllDigital && (
                <motion.div key="address" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                  className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-bold text-gray-900 flex items-center gap-2">
                      <MapPin className="w-5 h-5 text-primary" /> Delivery Address
                    </h2>
                    {address.state && (
                      <span className="text-xs text-gray-400 mt-0.5">All fields are editable</span>
                    )}
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Full Name" required>
                      <input value={address.fullName} onChange={(e) => setAddress({ ...address, fullName: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none text-sm"
                        placeholder="Adebayo Johnson" />
                    </Field>

                    <Field label="Phone Number" required hint="e.g. 08012345678">
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input value={address.phone} onChange={(e) => setAddress({ ...address, phone: e.target.value })}
                          onBlur={(e) => { const v = e.target.value.trim(); if (v) setAddress((a) => ({ ...a, phone: formatNigerianPhone(v) })); }}
                          type="tel" inputMode="numeric"
                          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none text-sm"
                          placeholder="08012345678" />
                      </div>
                    </Field>
                  </div>

                  {/* Email — required for guests (no account email to fall back on) */}
                  {isGuest && (
                    <Field label="Email Address" required hint="Your order confirmation will be sent here">
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="email"
                          value={address.email}
                          onChange={(e) => setAddress({ ...address, email: e.target.value })}
                          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none text-sm"
                          placeholder="you@example.com"
                        />
                      </div>
                    </Field>
                  )}

                  {/* Coordinates come from the map, not from resolving the typed
                      address. Mapbox cannot place Nigerian street addresses
                      reliably — an address naming Ibadan resolves to a Lagos
                      street — and these coordinates decide both the delivery fee
                      and where the rider is sent. The written address below is
                      what helps them find the door once they arrive.
                      Keyed on state so picking one re-centres the map. */}
                  <Field
                    label="Show us where to deliver"
                    hint="Drag the map until the crosshair sits on your building. This sets your delivery fee and guides the rider to your door."
                  >
                    <MapPickupPicker
                      key={address.state || "no-state"}
                      value={address.lat != null && address.lng != null
                        ? { latitude: address.lat, longitude: address.lng }
                        : null}
                      initialCentre={stateCentre(address.state)}
                      onChange={({ latitude, longitude }) =>
                        setAddress((p) => ({ ...p, lat: latitude, lng: longitude }))}
                    />
                    {address.lat != null && address.lng != null ? (
                      <p className="text-xs text-green-600 flex items-center gap-1 mt-1.5">
                        <CheckCircle className="w-3.5 h-3.5" /> Delivery location saved
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500 mt-1.5">
                        {address.state
                          ? "Mark your location so we can price delivery accurately."
                          : "Choose your state below, then mark your exact location."}
                      </p>
                    )}
                  </Field>

                  <div className="grid sm:grid-cols-3 gap-4">
                    <Field label="House No.">
                      <input value={address.houseNumber} onChange={(e) => setAddress({ ...address, houseNumber: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none text-sm"
                        placeholder="12" />
                    </Field>

                    <Field label="Street" required className="sm:col-span-2">
                      <input value={address.street} onChange={(e) => setAddress({ ...address, street: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none text-sm"
                        placeholder="Adeola Odeku Street" />
                    </Field>
                  </div>

                  <Field label="Landmark" required hint="Critical for Nigerian delivery — e.g. 'Close to Access Bank', 'Opposite Total petrol station'">
                    <div className="relative">
                      <Landmark className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input value={address.landmark} onChange={(e) => setAddress({ ...address, landmark: e.target.value })}
                        className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none text-sm"
                        placeholder="Opposite Access Bank, beside Total petrol station" />
                    </div>
                  </Field>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Area / Estate">
                      <input value={address.area} onChange={(e) => setAddress({ ...address, area: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none text-sm"
                        placeholder="Victoria Island" />
                    </Field>

                    <Field label="City" required>
                      <input value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/15 outline-none text-sm"
                        placeholder="Lagos" />
                    </Field>
                  </div>

                  <StateLgaPicker
                    stateValue={address.state}
                    lgaValue={address.lga}
                    onStateChange={(val) => setAddress((prev) => ({ ...prev, state: val, lga: "" }))}
                    onLgaChange={(val) => setAddress((prev) => ({ ...prev, lga: val }))}
                  />

                  <Field label="Delivery Instructions" hint="Optional: gate colour, floor, call on arrival">
                    <textarea value={address.deliveryInstructions} onChange={(e) => setAddress({ ...address, deliveryInstructions: e.target.value })}
                      rows={2}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none text-sm resize-none"
                      placeholder="Blue gate, 2nd floor, call 10 mins before arrival" />
                  </Field>
                </motion.div>
              )}

              {/* STEP 1 — Delivery (physical only) */}
              {step === 1 && !isAllDigital && (
                <motion.div key="delivery" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                  className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4"
                >
                  <h2 className="font-bold text-gray-900 flex items-center gap-2">
                    <Truck className="w-5 h-5 text-primary" /> Choose Delivery
                  </h2>
                  {DELIVERY_OPTIONS.map((opt) => (
                    <label key={opt.id} className={`flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-colors ${
                      delivery === opt.id ? "border-primary bg-primary/5" : "border-gray-200 hover:border-gray-300"
                    }`}>
                      <div className="flex items-center gap-3">
                        <input type="radio" value={opt.id} checked={delivery === opt.id} onChange={() => setDelivery(opt.id)} className="accent-primary" />
                        <div>
                          <p className="font-semibold text-gray-900 text-sm">{opt.label}</p>
                          <p className="text-xs text-gray-500">{opt.duration}</p>
                        </div>
                      </div>
                      <span className="font-bold text-gray-900 text-sm">₦{opt.fee.toLocaleString()}</span>
                    </label>
                  ))}
                </motion.div>
              )}

              {/* STEP 2 (physical) / STEP 1 (digital) — Payment */}
              {(step === 2 || (step === 1 && isAllDigital)) && (
                <motion.div key="payment" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                  className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4"
                >
                  <h2 className="font-bold text-gray-900 flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-primary" /> Payment Method
                  </h2>
                  {PAYMENT_METHODS.map((m) => (
                    <label key={m.id} className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${
                      payment === m.id ? "border-primary bg-primary/5" : "border-gray-200 hover:border-gray-300"
                    }`}>
                      <input type="radio" value={m.id} checked={payment === m.id} onChange={() => setPayment(m.id)} className="accent-primary mt-0.5" />
                      <m.icon className="w-5 h-5 text-gray-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{m.label}</p>
                        <p className="text-xs text-gray-500">{m.sub}</p>
                      </div>
                    </label>
                  ))}

                </motion.div>
              )}

              {/* STEP 3 (physical) / STEP 2 (digital) — Review */}
              {(step === 3 || (step === 2 && isAllDigital)) && (
                <motion.div key="review" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                  className="bg-white rounded-2xl border border-gray-100 p-6 space-y-6"
                >
                  <h2 className="font-bold text-gray-900">Order Review</h2>

                  {/* Items */}
                  <div className="space-y-3">
                    {items.map((item) => (
                      <div key={item.cartKey ?? item.productId} className="flex items-center gap-3">
                        <div className="relative w-14 h-14 rounded-xl overflow-hidden bg-gray-100 shrink-0">
                          {item.image && <Image src={item.image} alt={item.name} fill className="object-cover" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 line-clamp-1">{item.name}</p>
                          {item.variantCombination && (
                            <p className="text-xs text-gray-400">
                              {Object.entries(item.variantCombination).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                            </p>
                          )}
                          <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                        </div>
                        <span className="text-sm font-bold text-gray-900">₦{(item.price * item.quantity).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>

                  {/* Address summary */}
                  {isAllDigital ? (
                    <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-1">
                      <p className="font-semibold text-gray-900 flex items-center gap-1.5"><Download className="w-4 h-4 text-primary" /> Download to</p>
                      <p className="text-gray-700">{address.fullName}</p>
                      <p className="text-gray-700 font-medium">{address.email}</p>
                    </div>
                  ) : (
                    <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-1">
                      <p className="font-semibold text-gray-900 flex items-center gap-1.5"><MapPin className="w-4 h-4 text-primary" /> Delivery to</p>
                      <p className="text-gray-700">{[address.houseNumber, address.street].filter(Boolean).join(" ")}</p>
                      <p className="text-gray-700">{address.landmark}</p>
                      <p className="text-gray-700">{[address.area, address.city, address.lga, address.state].filter(Boolean).join(", ")}</p>
                      <p className="text-gray-700 font-medium">{address.phone}</p>
                    </div>
                  )}

                  {/* Delivery & payment summary */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-gray-50 rounded-xl p-3">
                      <p className="text-gray-500 text-xs mb-1">Delivery</p>
                      <p className="font-semibold text-gray-900">{DELIVERY_OPTIONS.find((o) => o.id === delivery)?.label}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3">
                      <p className="text-gray-500 text-xs mb-1">Payment</p>
                      <p className="font-semibold text-gray-900">{PAYMENT_METHODS.find((m) => m.id === payment)?.label.split("(")[0].trim()}</p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Mobile order total strip — shows total before the user taps Continue/Pay */}
            <div className="lg:hidden flex items-center justify-between bg-white border border-gray-100 rounded-2xl px-4 py-3 mt-4">
              <div className="text-sm text-gray-500">
                {items.reduce((s, i) => s + i.quantity, 0)} item{items.reduce((s, i) => s + i.quantity, 0) !== 1 ? "s" : ""}
                {deliveryFee > 0 && <span className="text-gray-400"> · incl. delivery</span>}
              </div>
              <div className="text-right">
                <p className="text-[11px] text-gray-400 uppercase tracking-wide">Total</p>
                <p className="font-bold text-gray-900">₦{grandTotal.toLocaleString()}</p>
              </div>
            </div>

            {/* Navigation buttons */}
            <div className="flex gap-3 mt-3">
              {step > 0 && (
                <button onClick={back} className="flex-1 py-3 rounded-full border-2 border-gray-200 text-sm font-semibold text-gray-700 hover:border-gray-400 transition-colors">
                  Back
                </button>
              )}
              {step < STEPS.length - 1 ? (
                <button onClick={next} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full bg-primary text-white text-sm font-semibold hover:opacity-90 transition-opacity">
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={handlePlaceOrder}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-full bg-linear-to-r from-primary to-primary-dark text-white font-semibold hover:shadow-xl hover:shadow-primary/25 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                >
                  {loading ? "Processing..." : `Pay ₦${amountDue.toLocaleString()}`}
                </button>
              )}
            </div>
          </div>

          {/* ── Order summary sidebar ──────────────────────────────────── */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl border border-gray-100 p-5 sticky top-24 space-y-4">
              <h3 className="font-bold text-gray-900 text-sm">Order Summary</h3>

              <div className="space-y-2 text-sm max-h-52 overflow-y-auto">
                {items.map((item) => (
                  <div key={item.productId} className="flex justify-between text-gray-600">
                    <span className="line-clamp-1 flex-1">{item.name} ×{item.quantity}</span>
                    <span className="shrink-0 ml-2 font-medium text-gray-900">₦{(item.price * item.quantity).toLocaleString()}</span>
                  </div>
                ))}
              </div>

              {/* Promo code input */}
              {appliedPromo ? (
                <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                  <div className="flex items-center gap-2 text-xs text-green-700">
                    <Tag className="w-3.5 h-3.5" />
                    <span className="font-mono font-bold">{appliedPromo.code}</span>
                    <span>— {appliedPromo.description}</span>
                  </div>
                  <button onClick={removePromo} className="text-green-500 hover:text-green-700 transition-colors ml-2">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <input
                      value={promoInput}
                      onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && applyPromo()}
                      placeholder="Promo code"
                      className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono uppercase"
                    />
                  </div>
                  <button
                    onClick={applyPromo}
                    disabled={promoValidating || !promoInput.trim()}
                    className="px-3 py-2 text-xs font-semibold text-primary border border-primary rounded-xl hover:bg-primary/5 transition-colors disabled:opacity-40"
                  >
                    {promoValidating ? "…" : "Apply"}
                  </button>
                </div>
              )}

              <div className="border-t border-gray-100 pt-3 space-y-2 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span className="font-medium text-gray-900">₦{total.toLocaleString()}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span className="font-medium">−₦{discount.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-600">
                  <span>Delivery{canQuote && quoteLoading && <span className="text-gray-400"> · calculating…</span>}</span>
                  <span className="font-medium text-gray-900">₦{deliveryFee.toLocaleString()}</span>
                </div>
                <div className="border-t border-gray-100 pt-2 flex justify-between font-bold text-base text-gray-900">
                  <span>Total</span>
                  <span className="text-primary">₦{grandTotal.toLocaleString()}</span>
                </div>
              </div>

              {/* Trust badges */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-100">
                {[
                  { icon: ShieldCheck, label: "Buyer Protection" },
                  { icon: Truck,       label: "Fast Delivery"    },
                  { icon: CheckCircle, label: "7-Day Returns"    },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex flex-col items-center gap-1 text-center">
                    <Icon className="w-4 h-4 text-primary" />
                    <span className="text-[10px] font-semibold text-gray-600">{label}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                <ShieldCheck className="w-4 h-4 text-green-500" />
                Secured by Flutterwave
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
