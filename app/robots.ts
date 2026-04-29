import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin/",
          "/jury/",
          "/dashboard/",
          "/event/",
          "/api/",
          "/auth/",
          "/login",
          "/register",
          "/forgot-password",
          "/reset-password",
          "/confirm",
          "/preview-login",
        ],
      },
    ],
    sitemap: "https://ehl.gg/sitemap.xml",
  };
}
