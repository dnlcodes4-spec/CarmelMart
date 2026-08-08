import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { config } from "@/lib/config";
import { syncPickupAddress, recordSyncError } from "@/lib/fastlink/merchants";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = createAdminClient();

    const { data: vendor, error: vErr } = await admin
      .from("vendors")
      .select(`
        id, business_name, description, return_policy, vacation_mode,
        phone, city, state, bank_account_number, bank_code, bank_name, bank_account_name,
        notification_preferences,
        pickup_label, pickup_address, pickup_lat, pickup_lng, fastlink_merchant_id
      `)
      .eq("id", user.id)
      .single();

    if (vErr) throw vErr;

    return NextResponse.json({ settings: vendor ?? {} });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const {
      business_name, description, return_policy, vacation_mode,
      phone, city, state, bank_account_number, bank_code, bank_name,
      notification_preferences,
      pickup_label, pickup_address, pickup_lat, pickup_lng,
    } = body;

    const update = {};
    if (business_name      !== undefined) update.business_name      = business_name.trim();
    if (description        !== undefined) update.description        = description.trim();
    if (return_policy      !== undefined) update.return_policy      = return_policy.trim();
    if (vacation_mode      !== undefined) update.vacation_mode      = Boolean(vacation_mode);
    if (phone              !== undefined) update.phone              = phone.trim();
    if (city               !== undefined) update.city               = city.trim();
    if (state              !== undefined) update.state              = state.trim();
    if (bank_account_number !== undefined) update.bank_account_number = bank_account_number.trim();
    if (bank_code          !== undefined) update.bank_code          = bank_code.trim();
    if (bank_name          !== undefined) update.bank_name          = bank_name.trim();
    if (notification_preferences !== undefined) update.notification_preferences = notification_preferences;
    // Fast Link pickup location. Coordinates come from the vendor placing a map pin;
    // the address text is a description for the rider, not a geocoding source.
    if (pickup_label   !== undefined) update.pickup_label   = pickup_label?.trim() || null;
    if (pickup_address !== undefined) update.pickup_address = pickup_address?.trim() || null;
    if (pickup_lat     !== undefined) update.pickup_lat     = pickup_lat != null && pickup_lat !== "" ? Number(pickup_lat) : null;
    if (pickup_lng     !== undefined) update.pickup_lng     = pickup_lng != null && pickup_lng !== "" ? Number(pickup_lng) : null;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ success: true });
    }

    const pickupChanged = ["pickup_label", "pickup_address", "pickup_lat", "pickup_lng"].some((k) => k in update);

    const admin = createAdminClient();

    // If bank details are changing, verify the account with Flutterwave before saving.
    if (update.bank_account_number !== undefined || update.bank_code !== undefined) {
      // Fetch current values to fill in whichever field isn't being updated
      const { data: current } = await admin
        .from("vendors")
        .select("bank_account_number, bank_code")
        .eq("id", user.id)
        .single();

      const resolveNumber = update.bank_account_number ?? current?.bank_account_number;
      const resolveCode   = update.bank_code           ?? current?.bank_code;

      if (!resolveNumber || !resolveCode) {
        return NextResponse.json(
          { error: "Both account number and bank code are required to verify bank details." },
          { status: 400 }
        );
      }

      const flwRes = await fetch("https://api.flutterwave.com/v3/accounts/resolve", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ account_number: resolveNumber, account_bank: resolveCode }),
        signal: AbortSignal.timeout(10_000),
      });

      const contentType = flwRes.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        const text = await flwRes.text();
        console.error("[vendor/settings] Flutterwave non-JSON response:", flwRes.status, text);
        return NextResponse.json(
          { error: "Bank verification service returned an unexpected response. Please try again." },
          { status: 502 }
        );
      }

      const flwData = await flwRes.json();
      console.log("[vendor/settings] Flutterwave resolve response:", JSON.stringify(flwData));

      if (flwData.status !== "success" || !flwData.data?.account_name) {
        console.error("[vendor/settings] Flutterwave verification failed:", flwData.message ?? flwData.status);
        return NextResponse.json(
          { error: flwData.message || "Could not verify bank account. Please check your account number and bank code." },
          { status: 400 }
        );
      }

      // Persist the verified account holder name so admins know who to pay.
      update.bank_account_name = flwData.data.account_name;
    }
    const { error: upErr } = await admin.from("vendors").update(update).eq("id", user.id);
    if (upErr) throw upErr;

    // If the pickup location changed, push a fresh default pickup to Fast Link.
    // Best-effort — never fail the settings save on a delivery-provider hiccup.
    if (pickupChanged && config.fastlink.enabled) {
      try {
        await syncPickupAddress(admin, user.id, { force: true });
      } catch (flErr) {
        console.error("[vendor/settings] Fast Link pickup sync failed:", flErr.message);
        await recordSyncError(admin, user.id, flErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
