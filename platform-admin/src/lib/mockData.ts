export type PackCategory = "limited" | "community" | "seasonal" | "legendary_vault";
export type RarityTier = "common" | "rare" | "epic" | "legendary" | "mythic";

export interface PackItem {
  id: string;
  name: string;
  category: PackCategory;
  categoryLabel: string;
  price: number;
  supplyLeft: number;
  totalSupply: number;
  oddsPreview: Record<string, string | number>;
  image: string;
  description: string;
}

export interface DrawRecord {
  id: string;
  username: string;
  avatarUrl: string;
  packName: string;
  reward: string;
  rarity: RarityTier;
  timestamp: number;
  rewardImage: string;
}

export interface BigWin {
  id: string;
  username: string;
  reward: string;
  rarity: RarityTier;
  image: string;
  timestamp: number;
}

export interface UserStats {
  totalPacksOpened: number;
  luckPercentage: number;
  totalWinnings: number;
  jackpotPool: number;
}

export const PACKS: PackItem[] = [
  {
    id: "p1",
    name: "Gecko Genesis",
    category: "limited",
    categoryLabel: "Limited Drop",
    price: 2.5,
    supplyLeft: 4120,
    totalSupply: 5000,
    oddsPreview: { Mythic: "1%", Legendary: "5%", Epic: "15%", Rare: "29%", Common: "50%" },
    image: "/packs/gecko-genesis.svg",
    description: "The original Geckura mystery pack. Rarest items mint.",
  },
  {
    id: "p2",
    name: "Cyber Hatch",
    category: "community",
    categoryLabel: "Community Pack",
    price: 0.75,
    supplyLeft: 12400,
    totalSupply: 20000,
    oddsPreview: { Legendary: "3%", Epic: "12%", Rare: "25%", Common: "60%" },
    image: "/packs/cyber-hatch.svg",
    description: "Community-favorite hatchling with neon glitch art rewards.",
  },
  {
    id: "p3",
    name: "Jungle Heat",
    category: "seasonal",
    categoryLabel: "Seasonal Pack",
    price: 1.5,
    supplyLeft: 890,
    totalSupply: 10000,
    oddsPreview: { Mythic: "0.5%", Legendary: "4%", Epic: "16%", Rare: "30%", Common: "49.5%" },
    image: "/packs/jungle-heat.svg",
    description: "Limited-time summer aesthetic. Burn haze edition.",
  },
  {
    id: "p4",
    name: "Vault Prime",
    category: "legendary_vault",
    categoryLabel: "Legendary Vault",
    price: 25,
    supplyLeft: 180,
    totalSupply: 500,
    oddsPreview: { Mythic: "8%", Legendary: "22%", Epic: "35%", Rare: "35%" },
    image: "/packs/vault-prime.svg",
    description: "Premium vault access. Guarantees Rare minimum.",
  },
  {
    id: "p5",
    name: "Nano Crate",
    category: "limited",
    categoryLabel: "Limited Drop",
    price: 0.25,
    supplyLeft: 31000,
    totalSupply: 50000,
    oddsPreview: { Epic: "8%", Rare: "22%", Common: "70%" },
    image: "/packs/nano-crate.svg",
    description: "Entry-level crate. Often surprising uncommon gems.",
  },
  {
    id: "p6",
    name: "Phantom Drop",
    category: "community",
    categoryLabel: "Community Pack",
    price: 4.0,
    supplyLeft: 3900,
    totalSupply: 7500,
    oddsPreview: { Mythic: "2%", Legendary: "10%", Epic: "23%", Rare: "35%", Common: "30%" },
    image: "/packs/phantom-drop.svg",
    description: "Stealth rarity unveiling. Gho vibes inside.",
  },
  {
    id: "p7",
    name: "Frost Antler",
    category: "seasonal",
    categoryLabel: "Seasonal Pack",
    price: 3.5,
    supplyLeft: 0,
    totalSupply: 3000,
    oddsPreview: { Legendary: "15%", Epic: "30%", Rare: "40%", Common: "15%" },
    image: "/packs/frost-antler.svg",
    description: "December season — snowy crystalline NFTs.",
  },
  {
    id: "p8",
    name: "Chrome Vault",
    category: "legendary_vault",
    categoryLabel: "Legendary Vault",
    price: 100,
    supplyLeft: 22,
    totalSupply: 100,
    oddsPreview: { Mythic: "25%", Legendary: "45%", Epic: "30%" },
    image: "/packs/chrome-vault.svg",
    description: "Elite endgame vault. Mythic guaranteed 1 in 3.",
  },
  {
    id: "p9",
    name: "Hex Box",
    category: "limited",
    categoryLabel: "Limited Drop",
    price: 12.0,
    supplyLeft: 780,
    totalSupply: 1500,
    oddsPreview: { Mythic: "5%", Legendary: "20%", Epic: "35%", Rare: "40%" },
    image: "/packs/hex-box.svg",
    description: "Geometric fragment series. Only 1 500 minted.",
  },
  {
    id: "p10",
    name: "Old School",
    category: "seasonal",
    categoryLabel: "Seasonal Pack",
    price: 6.0,
    supplyLeft: 55,
    totalSupply: 500,
    oddsPreview: { Epic: "40%", Rare: "45%", Common: "15%" },
    image: "/packs/old-school.svg",
    description: "Retro console-themed seasonal drop.",
  },
  {
    id: "p11",
    name: "Bug Loot",
    category: "community",
    categoryLabel: "Community Pack",
    price: 1.2,
    supplyLeft: 7000,
    totalSupply: 15000,
    oddsPreview: { Legendary: "2%", Epic: "8%", Rare: "25%", Common: "65%" },
    image: "/packs/bug-loot.svg",
    description: "Crowdfunded community bundle. Low cost, high fun.",
  },
  {
    id: "p12",
    name: "God Roll",
    category: "legendary_vault",
    categoryLabel: "Legendary Vault",
    price: 50,
    supplyLeft: 120,
    totalSupply: 300,
    oddsPreview: { Mythic: "10%", Legendary: "30%", Epic: "60%" },
    image: "/packs/god-roll.svg",
    description: "Perfect stats guaranteed. Elite collector item.",
  },
];

export const DRAW_RECORDS: DrawRecord[] = [
  { id: "d1", username: "GeckoGuru",    avatarUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=guru",  packName: "Gecko Genesis", reward: "Legendary Geckura #0842",  rarity: "legendary", timestamp: Date.now() - 12_000,   rewardImage: "https://picsum.photos/seed/g1/64/64" },
  { id: "d2", username: "0xWizard",      avatarUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=wizard", packName: "Vault Prime",    reward: "Mythic Diamond Ape",      rarity: "mythic",    timestamp: Date.now() - 38_000,   rewardImage: "https://picsum.photos/seed/g2/64/64" },
  { id: "d3", username: "LunaStack",     avatarUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=luna",  packName: "Phantom Drop",  reward: "Epic Galaxy Gecko",        rarity: "epic",      timestamp: Date.now() - 65_000,   rewardImage: "https://picsum.photos/seed/g3/64/64" },
  { id: "d4", username: "SolWhale99",    avatarUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=whale", packName: "Chrome Vault",  reward: "Rare Chrome Scale",        rarity: "rare",      timestamp: Date.now() - 102_000,  rewardImage: "https://picsum.photos/seed/g4/64/64" },
  { id: "d5", username: "DeFiDerrick",   avatarUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=derrick", packName: "Gecko Genesis", reward: "Epic Toxic Reptile",      rarity: "epic",      timestamp: Date.now() - 140_000,  rewardImage: "https://picsum.photos/seed/g5/64/64" },
  { id: "d6", username: "NeonFiona",     avatarUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=fiona",  packName: "Old School",    reward: "Common Retro Bytes",       rarity: "common",    timestamp: Date.now() - 183_000,  rewardImage: "https://picsum.photos/seed/g6/64/64" },
  { id: "d7", username: "ByteBaron",     avatarUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=baron",  packName: "Hex Box",       reward: "Mythic Sacred Hex",        rarity: "mythic",    timestamp: Date.now() - 225_000,  rewardImage: "https://picsum.photos/seed/g7/64/64" },
  { id: "d8", username: "crypto_cam",    avatarUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=cam",   packName: "Cyber Hatch",   reward: "Rare Neon Claw",           rarity: "rare",      timestamp: Date.now() - 268_000,  rewardImage: "https://picsum.photos/seed/g8/64/64" },
];

export const BIG_WINS: BigWin[] = [
  { id: "b1", username: "DegenDave", reward: "Mythic Diamond Ape",   rarity: "mythic",    image: "https://picsum.photos/seed/bw1/320/200", timestamp: Date.now() - 900_000 },
  { id: "b2", username: "CryptoQueen", reward: "Legendary Geckura #99", rarity: "legendary", image: "https://picsum.photos/seed/bw2/320/200", timestamp: Date.now() - 3_600_000 },
  { id: "b3", username: "0xPhantom",  reward: "Mythic Sacred Hex",    rarity: "mythic",    image: "https://picsum.photos/seed/bw3/320/200", timestamp: Date.now() - 7_200_000 },
  { id: "b4", username: "MoonKid",    reward: "Legendary Plasma Spine", rarity: "legendary", image: "https://picsum.photos/seed/bw4/320/200", timestamp: Date.now() - 14_400_000 },
];

export const LIVE_USERS = 3847;

export const INITIAL_STATS: UserStats = {
  totalPacksOpened: 147,
  luckPercentage: 68,
  totalWinnings: 892.43,
  jackpotPool: 25431.72,
};

export interface LeaderEntry {
  rank: number;
  username: string;
  value: number;
  avatar: string;
}

export const LEADERBOARD: LeaderEntry[] = [
  { rank: 1, username: "DegenDave",   value: 14320.0, avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=dave" },
  { rank: 2, username: "CryptoQueen", value: 9850.4,  avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=cqueen" },
  { rank: 3, username: "0xPhantom",   value: 7720.1,  avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=phantom" },
  { rank: 4, username: "MoonKid",     value: 6543.8,  avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=moonkid" },
  { rank: 5, username: "GeckoGuru",   value: 5210.2,  avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=guru" },
  { rank: 6, username: "ByteBaron",   value: 4100.5,  avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=baron" },
  { rank: 7, username: "LunaStack",   value: 3480.9,  avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=luna" },
  { rank: 8, username: "SolWhale99",  value: 2950.3,  avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=whale" },
];
