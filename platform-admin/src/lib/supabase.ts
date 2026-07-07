import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co").replace(/\s/g, "");
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-key").replace(/\s/g, "");
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");

export const isSupabaseConfigured = 
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && 
  !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("placeholder.supabase.co");

if (!isSupabaseConfigured) {
  console.warn("Warning: NEXT_PUBLIC_SUPABASE_URL environment variable is missing or using placeholder.");
}

export const supabase = createClient(
  supabaseUrl,
  supabaseServiceKey || supabaseAnonKey
);

