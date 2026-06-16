"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (path: string) => pathname === path || pathname?.startsWith(path + "/");

  return (
    <aside className="w-56 shrink-0 border-r border-gray-800 min-h-screen flex flex-col">
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-lg font-bold text-purple-400">MysteryBox</h1>
        <p className="text-xs text-gray-500 mt-0.5">Platform Admin</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        <Link href="/admin" className={`block px-3 py-2 rounded text-sm ${isActive("/admin") && !isActive("/admin/projects") ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-800/50"}`}>
          Platform Overview
        </Link>
        <Link href="/admin/projects" className={`block px-3 py-2 rounded text-sm ${isActive("/admin/projects") ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-800/50"}`}>
          Projects
        </Link>
      </nav>
      <div className="p-3 border-t border-gray-800 text-xs text-gray-600">
        Devnet · Bs4JjQ...
      </div>
    </aside>
  );
}
