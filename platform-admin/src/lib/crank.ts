import { Connection, Keypair, PublicKey, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { BorshAccountsCoder, BorshInstructionCoder } from "@coral-xyz/anchor";
import IDL from "./idl.json";
import * as fs from "fs";
import * as path from "path";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

// Load environment variables manually to avoid external dependency issues
function loadEnv() {
  const envPath = path.join(__dirname, "..", "..", ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index > 0) {
        const key = trimmed.substring(0, index).trim();
        const val = trimmed.substring(index + 1).trim();
        process.env[key] = val;
      }
    }
  }
}
loadEnv();

const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "CXX3hFgqL5bozH8pYbTtetMHVYWkHwcx46MwHeF7VVcv");

// Load keeper keypair
function getKeeperKeypair(): Keypair {
  // Try loading from env CRANK_PRIVATE_KEY
  if (process.env.CRANK_PRIVATE_KEY) {
    try {
      const raw = JSON.parse(process.env.CRANK_PRIVATE_KEY);
      return Keypair.fromSecretKey(new Uint8Array(raw));
    } catch {
      // ignore and try next
    }
  }
  
  // Try loading from ~/.config/solana/id.json
  const home = process.env.HOME || "";
  const defaultPath = path.join(home, ".config", "solana", "id.json");
  if (fs.existsSync(defaultPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(defaultPath, "utf-8"));
      return Keypair.fromSecretKey(new Uint8Array(raw));
    } catch (err) {
      console.error("Failed to load keypair from default path:", err);
    }
  }

  // Fallback: generate a random keypair
  console.warn("WARNING: Running with a temporary generated keypair. Please fund it or set CRANK_PRIVATE_KEY / ~/.config/solana/id.json");
  const kp = Keypair.generate();
  console.log(`Temp keeper pubkey: ${kp.publicKey.toBase58()}`);
  return kp;
}

// FNV-1a 64-bit hashing
function fnv1a(hashInput: Buffer): bigint {
  let randomVal = BigInt("14695981039346656037");
  const prime = BigInt("1099511628211");
  const mask = (BigInt(1) << BigInt(64)) - BigInt(1); // For wrapping multiplication (u64)
  for (const byte of hashInput) {
    randomVal ^= BigInt(byte);
    randomVal = (randomVal * prime) & mask;
  }
  return randomVal;
}

// Helper to decode IDL instruction
function buildCrankInstruction(
  name: string,
  accounts: Record<string, PublicKey>,
  args: any[],
  remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = []
) {
  const coder = new BorshInstructionCoder(IDL as any);
  const ixJson = (IDL as any).instructions.find((ix: any) => ix.name === name);
  if (!ixJson) throw new Error(`Unknown instruction: ${name}`);
  const ix = (coder as any).encode(
    ixJson,
    Object.entries(accounts).map(([k, v]) => ({ name: k, pubkey: v, isWritable: false, isSigner: false })),
    args
  ) as any;
  return {
    programId: PROGRAM_ID,
    data: ix.data,
    keys: [
      ...ix.accounts.map((a: any) => ({ pubkey: a.pubkey, isSigner: a.isSigner, isWritable: a.isWritable })),
      ...remainingAccounts
    ]
  };
}

async function getSlotHash(connection: Connection, targetSlot: number): Promise<Buffer | null> {
  const slotHashesPubkey = new PublicKey("SysvarS1otHashes111111111111111111111111111");
  const accountInfo = await connection.getAccountInfo(slotHashesPubkey);
  if (!accountInfo) return null;
  const data = accountInfo.data;
  if (data.length < 8) return null;
  const len = Number(data.readBigUInt64LE(0));
  for (let i = 0; i < len; i++) {
    const start = 8 + i * 40;
    if (start + 40 > data.length) break;
    const entrySlot = Number(data.readBigUInt64LE(start));
    if (entrySlot === targetSlot) {
      return data.subarray(start + 8, start + 40);
    }
  }
  return null;
}

async function runCrank() {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
  console.log(`Connecting to Solana cluster...`);
  const connection = new Connection(rpcUrl, "confirmed");
  const keeper = getKeeperKeypair();
  console.log(`Keeper Wallet Address: ${keeper.publicKey.toBase58()}`);

  const balance = await connection.getBalance(keeper.publicKey);
  console.log(`Keeper Wallet Balance: ${balance / 1e9} SOL`);

  const accountCoder = new BorshAccountsCoder(IDL as any);

  // Poll interval
  setInterval(async () => {
    try {
      const allAccounts = await connection.getProgramAccounts(PROGRAM_ID);
      const currentSlot = await connection.getSlot();

      // Find BoxReceipt accounts
      const receipts: any[] = [];
      const prizeItems: any[] = [];

      // Pass 1: Decode all accounts and group them
      for (const { pubkey, account } of allAccounts) {
        try {
          const decoded = accountCoder.decode("BoxReceipt", account.data);
          if (decoded && decoded.user) {
            receipts.push({ pubkey, ...decoded });
          }
        } catch {}

        try {
          const decoded = accountCoder.decode("PrizeItem", account.data);
          if (decoded && decoded.boxConfig) {
            prizeItems.push({ pubkey, ...decoded });
          }
        } catch {}
      }

      // Pass 2: Filter pending receipts
      const pendingReceipts = receipts.filter(r => r.pendingOpens > 0);

      for (const receipt of pendingReceipts) {
        const requestSlot = Number(receipt.requestSlot);
        if (currentSlot <= requestSlot) {
          // Wait for next slot
          continue;
        }

        console.log(`Processing pending receipt for user ${receipt.user.toBase58()} (box config: ${receipt.boxConfig.toBase58()})`);
        console.log(`Request Slot: ${requestSlot}, Current Slot: ${currentSlot}, Pending Opens: ${receipt.pendingOpens}`);

        // Fetch request slot hash
        const requestHash = await getSlotHash(connection, requestSlot);
        if (!requestHash) {
          console.warn(`Blockhash for slot ${requestSlot} not found in SysvarSlotHashes (yet or too old).`);
          continue;
        }

        // Determine matching PrizeItems for this box config
        const boxPrizes = prizeItems.filter(p => {
          const boxPk = p.boxConfig ?? p.box_config;
          return boxPk && boxPk.equals(receipt.boxConfig);
        });

        // ─── Deterministic Randomness emulation ───
        const hashInput = Buffer.alloc(112);
        receipt.user.toBuffer().copy(hashInput, 0);
        requestHash.copy(hashInput, 32);
        receipt.boxConfig.toBuffer().copy(hashInput, 64);
        
        const nonceBuf = Buffer.alloc(8);
        nonceBuf.writeBigUInt64LE(BigInt(receipt.nonce));
        nonceBuf.copy(hashInput, 96);

        const slotBuf = Buffer.alloc(8);
        slotBuf.writeBigUInt64LE(BigInt(requestSlot));
        slotBuf.copy(hashInput, 104);

        const randomVal = fnv1a(hashInput);

        // Fetch BoxConfig to get claimed counts
        const boxConfigAccount = allAccounts.find(a => a.pubkey.equals(receipt.boxConfig));
        if (!boxConfigAccount) {
          console.error("BoxConfig account not found!");
          continue;
        }
        const boxConfig = accountCoder.decode("BoxConfig", boxConfigAccount.account.data);
        if (!boxConfig) {
          console.error("Failed to decode BoxConfig!");
          continue;
        }

        let isWinner = false;
        let wonPrize: any = null;
        let totalWeight = BigInt(0);
        let guaranteedPrize: any = null;

        for (const prize of boxPrizes) {
          const idx = prize.index;
          if (idx < 20) {
            const claimed = boxConfig.claimedPrizes[idx];
            const rem = prize.totalCount - claimed;
            if (rem > 0) {
              totalWeight += BigInt(prize.winPercentage);
              if (prize.winPercentage === 100) {
                guaranteedPrize = prize;
              }
            }
          }
        }

        if (guaranteedPrize) {
          isWinner = true;
          wonPrize = guaranteedPrize;
        } else if (totalWeight > BigInt(0)) {
          const prizeRoll = randomVal % totalWeight;
          let cumulative = BigInt(0);
          for (const prize of boxPrizes) {
            const idx = prize.index;
            if (idx < 20) {
              const claimed = boxConfig.claimedPrizes[idx];
              const rem = prize.totalCount - claimed;
              if (rem > 0) {
                cumulative += BigInt(prize.winPercentage);
                if (prizeRoll < cumulative) {
                  isWinner = true;
                  wonPrize = prize;
                  break;
                }
              }
            }
          }
        }

        console.log(`Calculated outcome: isWinner=${isWinner}, prize=${wonPrize ? `Index: ${wonPrize.index}` : 'None'}`);

        // PDAs
        const [platformPubkey] = PublicKey.findProgramAddressSync([Buffer.from("platform")], PROGRAM_ID);
        // We need the project's slug to derive the project PDA.
        const projectPk = boxConfig.project;
        const projectAccount = allAccounts.find(a => a.pubkey.equals(projectPk));
        if (!projectAccount) {
          console.error("Project account not found!");
          continue;
        }
        const project = accountCoder.decode("Project", projectAccount.account.data);
        if (!project) {
          console.error("Failed to decode Project!");
          continue;
        }
        const [projectPubkey] = PublicKey.findProgramAddressSync([Buffer.from("project"), Buffer.from(project.slug)], PROGRAM_ID);
        const [vaultPk] = PublicKey.findProgramAddressSync([Buffer.from("vault"), projectPk.toBuffer()], PROGRAM_ID);

        let vaultTokenAccount: PublicKey | undefined;
        let userTokenAccount: PublicKey | undefined;
        let tokenProgram: PublicKey | undefined;

        if (isWinner && wonPrize) {
          const prizeType = Object.keys(wonPrize.prizeType ?? wonPrize.prize_type)[0].toLowerCase();
          if (prizeType === "spltoken" || prizeType === "nft") {
            const mint = wonPrize.tokenMint ?? wonPrize.token_mint;
            vaultTokenAccount = getAssociatedTokenAddressSync(mint, vaultPk, true);
            userTokenAccount = getAssociatedTokenAddressSync(mint, receipt.user);
            tokenProgram = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
          }
        }

        // Build remaining accounts: all PrizeItems for this box config.
        const remainingAccounts = boxPrizes.map(p => ({
          pubkey: p.pubkey,
          isSigner: false,
          isWritable: true
        }));

        // Build instruction
        const ixRaw = buildCrankInstruction("reveal_open", {
          platform: platformPubkey,
          project: projectPubkey,
          box_config: receipt.boxConfig,
          receipt: receipt.pubkey,
          vault: vaultPk,
          user: receipt.user,
          keeper: keeper.publicKey,
          system_program: SystemProgram.programId,
          slot_hashes: new PublicKey("SysvarS1otHashes111111111111111111111111111"),
          ...(vaultTokenAccount ? { vault_token_account: vaultTokenAccount } : {}),
          ...(userTokenAccount ? { user_token_account: userTokenAccount } : {}),
          ...(tokenProgram ? { token_program: tokenProgram } : {}),
        }, [project.slug, Number(boxConfig.boxId)], remainingAccounts);

        const tx = new Transaction().add(new TransactionInstruction({
          programId: ixRaw.programId,
          keys: ixRaw.keys,
          data: ixRaw.data
        }));

        tx.feePayer = keeper.publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        tx.sign(keeper);

        console.log("Broadcasting reveal_open transaction...");
        const sig = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed"
        });
        console.log(`Transaction submitted successfully! Signature: ${sig}`);
        await connection.confirmTransaction(sig, "confirmed");
        console.log("Transaction confirmed!");
      }
    } catch (err) {
      console.error("Crank iteration failed with error:", err);
    }
  }, 3000);
}

// Start crank if executed directly
if (require.main === module) {
  runCrank().catch(console.error);
}
