const nextConfig = {
  // sharp is a native module — keep it out of the webpack server bundle so Next
  // traces the platform binary from node_modules into the serverless function.
  serverExternalPackages: ["sharp"],

  // Retry failed chunk loads once before surfacing an error (helps with flaky CDN)
  webpack(config) {
    config.output.chunkLoadTimeout = 30000;
    return config;
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },

  // Make NEXT_PUBLIC_APP_ENV available to client components.
  // Its value comes from .env.development or .env.production (loaded by Next.js
  // automatically based on NODE_ENV). .env.local can override it.
  env: {
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV ?? "development",
  },
};

export default nextConfig;
