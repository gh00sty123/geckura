import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co").trim();
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-key").trim();
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.warn("Warning: NEXT_PUBLIC_SUPABASE_URL environment variable is missing.");
}

export const supabase = createClient(
  supabaseUrl,
  supabaseServiceKey || supabaseAnonKey
);
