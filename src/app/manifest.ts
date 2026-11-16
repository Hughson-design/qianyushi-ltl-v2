import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Qianyushi LTL Quotes",
    short_name: "LTL Quotes",
    start_url: "/quick-quote",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#176b4a",
    icons: [{ src: "/qianvushi-logo.jpg", type: "image/jpeg" }],
  };
}
