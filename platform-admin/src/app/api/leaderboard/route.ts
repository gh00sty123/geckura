import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DB_PATH = path.join(process.cwd(), "src/lib/leaderboard_db.json");

interface LeaderboardRecord {
  slug: string;
  sig: string;
  user: string;
  boxConfig: string;
  timestamp: number;
  isSolBox: boolean;
}

// Read database records
function readDb(): LeaderboardRecord[] {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return [];
    }
    const data = fs.readFileSync(DB_PATH, "utf8");
    if (!data.trim()) return [];
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading leaderboard database:", err);
    return [];
  }
}

// Write database records
function writeDb(data: LeaderboardRecord[]) {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Error writing leaderboard database:", err);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    if (!slug) {
      return NextResponse.json({ error: "Missing slug parameter" }, { status: 400 });
    }

    const db = readDb();
    const records = db.filter(r => r.slug === slug);
    return NextResponse.json(records);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Check for batch sync input
    if (Array.isArray(body)) {
      const db = readDb();
      let added = 0;
      for (const item of body) {
        const { slug, sig, user, boxConfig, isSolBox, timestamp } = item;
        if (slug && sig && user && boxConfig) {
          const exists = db.some(r => r.sig === sig);
          if (!exists) {
            db.push({
              slug,
              sig,
              user,
              boxConfig,
              timestamp: timestamp || Math.floor(Date.now() / 1000),
              isSolBox: !!isSolBox
            });
            added++;
          }
        }
      }
      if (added > 0) {
        writeDb(db);
      }
      return NextResponse.json({ success: true, added });
    } else {
      // Single log record
      const { slug, sig, user, boxConfig, isSolBox, timestamp } = body;
      if (!slug || !sig || !user || !boxConfig) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      const db = readDb();
      const exists = db.some(r => r.sig === sig);
      if (!exists) {
        db.push({
          slug,
          sig,
          user,
          boxConfig,
          timestamp: timestamp || Math.floor(Date.now() / 1000),
          isSolBox: !!isSolBox
        });
        writeDb(db);
      }
      return NextResponse.json({ success: true });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
