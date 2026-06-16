"use client";

import { type ReactNode, useCallback } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletError } from "@solana/wallet-adapter-base";
import toast from "react-hot-toast";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

export default function WalletProviders({ children }: { children: ReactNode }) {
  const handleWalletError = useCallback((error: WalletError) => {
    const msg = error.message || String(error);
    if (
      msg.includes("User rejected the request") ||
      msg.includes("rejected") ||
      error.name === "WalletSignTransactionError"
    ) {
      // Log user cancellations as a warning instead of a console error to prevent triggering the Next.js dev overlay
      console.warn("[Wallet] Transaction cancelled by user:", error);
      return;
    }

    if (
      msg.includes("disconnected port") ||
      msg.includes("disconnected") ||
      msg.includes("Disconnected")
    ) {
      console.warn("[Wallet] Extension port disconnected:", error);
      toast.error("Wallet connection lost. Please reload the page or reconnect your wallet.");
      return;
    }

    // Other unexpected errors should be logged as errors
    console.error("[Wallet] Error:", error);
  }, []);

  // No manual adapters — let WalletProvider merge [] with auto-discovered
  // standard wallets (Phantom, Solflare, Backpack, …) via:
  //   useStandardWalletAdapters(adapters)
  // Passing [] avoids any stale-adapter double-construction that breaks
  // handleConnect / signTransaction down the tree.
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={[]} autoConnect onError={handleWalletError}>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
