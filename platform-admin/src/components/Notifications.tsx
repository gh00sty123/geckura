"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiX, FiBell, FiGift, FiAward, FiPackage } from "react-icons/fi";
import { useWallet } from "@solana/wallet-adapter-react";

interface Notification {
  id: string;
  type: "win" | "new_pack" | "daily_reward";
  message: string;
  timestamp: number;
  read: boolean;
}

export default function Notifications() {
  const { publicKey } = useWallet();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const formatTimeAgo = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hr ago`;
    return `${days} days ago`;
  };

  const getNotificationIcon = (type: Notification["type"]) => {
    switch (type) {
      case "win":
        return <FiAward className="text-amber-400" />;
      case "new_pack":
        return <FiPackage className="text-blue-400" />;
      case "daily_reward":
        return <FiGift className="text-[#1cac64]" />;
      default:
        return <FiBell className="text-[#2d5a3f]" />;
    }
  };

  const addNotification = useCallback((notification: Omit<Notification, "id" | "read">) => {
    const newNotification: Notification = {
      ...notification,
      id: Date.now().toString(),
      read: false,
    };
    setNotifications((prev) => [newNotification, ...prev]);
  }, []);

  const markAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const clearAll = () => {
    setNotifications([]);
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Mock notifications for demo - in real app, these would come from your backend/events
  useEffect(() => {
    if (publicKey) {
      // Add sample notifications
      const sampleNotifications: Omit<Notification, "id" | "read">[] = [
        {
          type: "win",
          message: "You won a Legendary NFT!",
          timestamp: Date.now() - 120000, // 2 min ago
        },
        {
          type: "new_pack",
          message: "New pack drop just live",
          timestamp: Date.now() - 3600000, // 1 hr ago
        },
        {
          type: "daily_reward",
          message: "Daily reward ready",
          timestamp: Date.now() - 10800000, // 3 hrs ago
        },
      ];

      sampleNotifications.forEach((n, i) => {
        setTimeout(() => addNotification(n), i * 100);
      });
    }
  }, [publicKey, addNotification]);

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-xl hover:bg-[#1cac64]/6 transition-colors text-[#2d5a3f] hover:text-[#0f2618]"
      >
        <FiBell className="text-xl" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 h-2 w-2 bg-[#1cac64] rounded-full" />
        )}
      </button>

      {/* Notifications dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute right-0 top-full mt-2 w-80 max-h-[450px] overflow-hidden bg-[#111] rounded-2xl border border-[#1cac64]/12 shadow-2xl z-50"
          >
            {/* Header */}
            <div className="p-4 border-b border-[#1cac64]/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FiBell className="text-[#1cac64]" />
                <h3 className="text-sm font-bold text-[#0f2618]">Notifications</h3>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-[#1cac64]/10 text-[#1cac64] text-[10px] font-bold">
                    {unreadCount} new
                  </span>
                )}
              </div>
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="text-xs text-[#3d6b4e] hover:text-[#1a3a2a] transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Notifications list */}
            <div className="overflow-y-auto max-h-[380px]">
              {notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <FiBell className="text-3xl text-[#4a7d5e] mx-auto mb-2" />
                  <p className="text-[#3d6b4e] text-sm">No notifications yet</p>
                </div>
              ) : (
                notifications.map((notification) => (
                  <div
                    key={notification.id}
                    onClick={() => markAsRead(notification.id)}
                    className={`p-4 border-b border-[#1cac64]/8 hover:bg-[#1cac64]/3 transition-colors cursor-pointer ${
                      !notification.read ? "bg-white/[0.01]" : ""
                    }`}
                  >
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 mt-0.5">
                        {getNotificationIcon(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#0f2618] font-medium">
                          {notification.message}
                        </p>
                        <p className="text-xs text-[#3d6b4e] mt-1">
                          {formatTimeAgo(notification.timestamp)}
                        </p>
                      </div>
                      {!notification.read && (
                        <div className="flex-shrink-0 w-2 h-2 bg-[#1cac64] rounded-full mt-2" />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}