"use client";

import { ReactNode, Suspense, useCallback } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { WalletError } from "@solana/wallet-adapter-base";
import toast from "react-hot-toast";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

function WalletButtons() {
  return (
    <div className="flex items-center gap-3">
      <WalletMultiButton />
    </div>
  );
}

export default function Providers({ children }: { children: ReactNode }) {
  const handleWalletError = useCallback((error: WalletError) => {
    const msg = error.message || String(error);
    if (
      msg.includes("User rejected the request") ||
      msg.includes("rejected") ||
      error.name === "WalletSignTransactionError"
    ) {
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

    console.error("[Wallet] Error:", error);
  }, []);

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
