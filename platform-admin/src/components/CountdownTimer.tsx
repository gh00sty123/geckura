"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { FiClock, FiZap, FiGift, FiCalendar } from "react-icons/fi";

type Tier = "day" | "hour" | "min" | "sec";

function pad(n: number) { return n.toString().padStart(2, "0"); }

export default function CountdownTimer({
  label = "Limited Drop Ends",
  targetMinutes = 3 * 60 + 42,
  onExpire,
}: {
  label?: string;
  targetMinutes?: number;
  onExpire?: () => void;
}) {
  const calc = useCallback(() => {
    const diff = targetMinutes * 60 - Math.floor(Math.random() * 5);
    const total = Math.max(0, diff);
    const hours = Math.floor(total / 3600);
    const mins  = Math.floor((total % 3600) / 60);
    const secs  = total % 60;
    return [hours, mins, secs] as const;
  }, [targetMinutes]);

  const [count, setCount] = useState(calc);

  useEffect(() => {
    const id = setInterval(() => {
      const [h, m, s] = count;
      if (h === 0 && m === 0 && s === 0) {
        clearInterval(id);
        onExpire?.();
      } else if (s > 0) {
        setCount([h, m, s - 1]);
      } else if (m > 0) {
        setCount([h, m - 1, 59]);
      } else {
        setCount([h - 1, 59, 59]);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [count, onExpire]);

  const units: [Tier, number][] = [
    ["hour",  count[0] === 1 ? count[0] : count[0]],
    ["min",   count[1]],
    ["sec",   count[2]],
  ];

  return (
    <div className="glass-panel rounded-2xl p-5 space-y-3.5">
      <div className="flex items-center gap-2">
        <FiClock className="text-amber-400" />
        <h3 className="text-sm font-bold text-white">{label}</h3>
      </div>

      <div className="flex items-center gap-2">
        {units.map(([unit, value], i) => {
          const nextUnit: Tier | undefined = units[i + 1]?.[0] as Tier | undefined;
          return (
            <div key={unit} className="flex items-center">
              {/* Digit block */}
              <div className="flex flex-col items-center gap-0.5 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] min-w-[52px]">
                <span className="text-xl font-black tabular-nums text-white">
                  {pad(value)}
                </span>
                <span className="text-[9px] text-gray-500 uppercase tracking-wider">
                  {unit === "hour" ? "hrs" : unit === "min" ? "mins" : "secs"}
                </span>
              </div>
              {i < units.length - 1 && (
                <span className="text-amber-400 text-lg font-black mx-0.5">:</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
