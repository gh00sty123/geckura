"use client";

import type { ReactNode } from "react";
import Navbar from "@/components/Navbar";

export default function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <Navbar />
      {children}
    </div>
  );
}
