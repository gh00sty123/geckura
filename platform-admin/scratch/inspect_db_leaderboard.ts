import { supabase, isSupabaseConfigured } from "../src/lib/supabase";

async function main() {
  if (!isSupabaseConfigured) {
    console.log("Supabase not configured");
    return;
  }

  const { data, error } = await supabase
    .from("leaderboard")
    .select("*");

  if (error) {
    console.error("Error reading leaderboard:", error);
    return;
  }

  console.log(`Found ${data?.length} total records in leaderboard table:\n`);
  
  const countsBySig: Record<string, number> = {};
  for (const item of data || []) {
    countsBySig[item.sig] = (countsBySig[item.sig] || 0) + 1;
    console.log(`ID: ${item.id} | Slug: ${item.slug} | User: ${item.user} | Sig: ${item.sig} | Won: ${item.won} | Date: ${item.created_at || item.timestamp}`);
  }

  console.log("\nCounts by signature:");
  console.log(JSON.stringify(countsBySig, null, 2));
}

main().catch(console.error);
