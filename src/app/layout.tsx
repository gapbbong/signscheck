import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import TawkToWidget from "@/components/TawkToWidget";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SignsCheck Dashboard",
  description: "Secure Remote Signing Service",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          {children}
          <TawkToWidget />
        </AuthProvider>
      </body>
    </html>
  );
}
