import type { NextConfig } from "next";
import { readFileSync } from "fs";

// 화면에 표시할 버전: package.json 버전 + 배포 커밋 해시(Vercel 빌드 시 제공)
const { version } = JSON.parse(readFileSync("./package.json", "utf-8")) as { version: string };

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_COMMIT: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7),
  },
};

export default nextConfig;
