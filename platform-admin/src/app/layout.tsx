import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import WalletProviders from "@/components/WalletProviders";
import { ProjectBrandingProvider } from "@/lib/ProjectBrandingProvider";
import Shell from "@/components/Shell";
import "./globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import { Toaster } from "react-hot-toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Geckura — Mystery Pack NFT Storefront",
  description: "Premium Solana-powered mystery pack NFT marketplace. Open rare collectibles, earn rewards.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-[#0a0a0a] toB" data-theme="dark">
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#171717",
              color: "#d8d8d8",
              border: "1px solid rgba(57,255,20,0.2)",
              borderRadius: "12px",
              fontFamily: "var(--font-geist-sans)",
            },
            success: { iconTheme: { primary: "#39ff14", secondary: "#0a0a0a" } },
            error:   { iconTheme: { primary: "#ef4444", secondary: "#0a0a0a" } },
          }}
        />
        <WalletProviders>
          <ProjectBrandingProvider>
            <Shell>{children}</Shell>
          </ProjectBrandingProvider>
        </WalletProviders>
      </body>
    </html>
  );
}
