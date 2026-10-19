import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 投稿の画像アップロード（ブラウザで縮小して送るが、余裕を持たせる）
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
