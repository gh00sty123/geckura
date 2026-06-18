"use client";

import type { ReactNode } from "react";
import Navbar from "@/components/Navbar";

export default function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#ebfde3] text-[#1a3a2a]">
      <Navbar />
      {children}
    </div>
  );
}
