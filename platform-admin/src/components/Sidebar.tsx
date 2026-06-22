"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NETWORK, PROGRAM_ID } from "@/lib/env";

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (path: string) => pathname === path || pathname?.startsWith(path + "/");

  const isMainnet = NETWORK.toLowerCase().includes("mainnet");
  const networkLabel = isMainnet ? "Mainnet" : "Devnet";
  const shortId = PROGRAM_ID ? `${PROGRAM_ID.slice(0, 6)}...${PROGRAM_ID.slice(-4)}` : "";

  return (
    <aside className="w-56 shrink-0 border-r border-[#1cac64]/20 min-h-screen flex flex-col">
      <div className="p-4 border-b border-[#1cac64]/20">
        <h1 className="text-lg font-bold text-[#1cac64]">GeckuraBox</h1>
        <p className="text-xs text-[#3d6b4e] mt-0.5">Platform Admin</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        <Link href="/admin" className={`block px-3 py-2 rounded text-sm ${isActive("/admin") && !isActive("/admin/projects") ? "bg-[#c8edba] text-[#0f2618]" : "text-[#2d5a3f] hover:bg-[#c8edba]/50"}`}>
          Platform Overview
        </Link>
        <Link href="/admin/projects" className={`block px-3 py-2 rounded text-sm ${isActive("/admin/projects") ? "bg-[#c8edba] text-[#0f2618]" : "text-[#2d5a3f] hover:bg-[#c8edba]/50"}`}>
          Projects
        </Link>
      </nav>
      <div className="p-3 border-t border-[#1cac64]/20 text-xs text-[#4a7d5e] font-mono">
        {networkLabel} · {shortId}
      </div>
    </aside>
  );
}

