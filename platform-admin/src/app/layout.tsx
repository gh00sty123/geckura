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
  icons: {
    icon: "/geckura-logo.jpg",
    shortcut: "/geckura-logo.jpg",
    apple: "/geckura-logo.jpg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full bg-[#ebfde3]" data-theme="light" suppressHydrationWarning>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#ffffff",
              color: "#1a3a2a",
              border: "1px solid rgba(28,172,100,0.25)",
              borderRadius: "12px",
              fontFamily: "var(--font-geist-sans)",
            },
            success: { iconTheme: { primary: "#1cac64", secondary: "#ffffff" } },
            error:   { iconTheme: { primary: "#ef4444", secondary: "#ffffff" } },
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
