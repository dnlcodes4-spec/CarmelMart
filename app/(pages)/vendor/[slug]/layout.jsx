import { createAdminClient } from "@/lib/supabase/admin";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  try {
    const admin = createAdminClient();
    // No product embed here: products.vendor_id FKs to users.id, not vendors.id,
    // so PostgREST has no relationship to traverse. vendors.id === users.id, so
    // the sample image is fetched in a second query keyed on the vendor id.
    const { data: vendor } = await admin
      .from("vendors")
      .select("id, business_name")
      .eq("slug", slug)
      .eq("verification_status", "verified")
      .maybeSingle();

    if (!vendor) return { title: "Vendor Store | CarmelMart" };

    const { data: product } = await admin
      .from("products")
      .select("images")
      .eq("vendor_id", vendor.id)
      .eq("status", "active")
      .eq("moderation_status", "approved")
      .limit(1)
      .maybeSingle();

    const image = product?.images?.[0] ?? null;
    const name  = vendor.business_name;

    return {
      title: `${name} | CarmelMart Vendor`,
      description: `Shop from ${name} on CarmelMart — verified Nigerian vendor. Browse their full product catalogue.`,
      openGraph: {
        title: `${name} | CarmelMart`,
        description: `Explore products from ${name}, a verified vendor on CarmelMart Nigeria.`,
        images: image ? [{ url: image, alt: name }] : [],
        type: "website",
      },
    };
  } catch {
    return { title: "Vendor Store | CarmelMart" };
  }
}

export default function VendorStoreLayout({ children }) { return children; }
