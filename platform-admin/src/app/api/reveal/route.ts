import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "buffer";
if (typeof globalThis !== "undefined" && !globalThis.Buffer) {
  globalThis.Buffer = Buffer;
}
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import IDL from "@/lib/idl.json";
import { buildIx, platformPDA, projectPDA, boxPDA, vaultPDA } from "@/lib/program-ix";

const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4");
const RPC = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

// Load keeper keypair from environment variables
function getKeeperKeypair(): Keypair | null {
  if (process.env.CRANK_PRIVATE_KEY) {
    try {
      const raw = JSON.parse(process.env.CRANK_PRIVATE_KEY);
      return Keypair.fromSecretKey(new Uint8Array(raw));
    } catch (e) {
      console.error("[RevealAPI] Failed to parse CRANK_PRIVATE_KEY:", e);
    }
  }
  return null;
}

// FNV-1a 64-bit hashing (matches on-chain logic)
function fnv1a(hashInput: Buffer): bigint {
  let randomVal = BigInt("14695981039346656037");
  const prime = BigInt("1099511628211");
  const mask = (BigInt(1) << BigInt(64)) - BigInt(1);
  for (const byte of hashInput) {
    randomVal ^= BigInt(byte);
    randomVal = (randomVal * prime) & mask;
  }
  return randomVal;
}

// Fetch SysvarSlotHashes blockhash for a target slot
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

export async function POST(req: NextRequest) {
  try {
    const { slug, boxId, receipt } = await req.json();
    if (!slug || boxId === undefined || !receipt) {
      return NextResponse.json({ error: "Missing required fields: slug, boxId, receipt" }, { status: 400 });
    }

    const keeper = getKeeperKeypair();
    if (!keeper) {
      return NextResponse.json({ error: "Server Configuration Error: CRANK_PRIVATE_KEY is not set in environment." }, { status: 500 });
    }

    const conn = new Connection(RPC, "confirmed");
    const receiptPk = new PublicKey(receipt);

    // 1. Fetch the BoxReceipt account info
    const receiptAcc = await conn.getAccountInfo(receiptPk);
    if (!receiptAcc) {
      return NextResponse.json({ error: "Receipt account not found on-chain." }, { status: 404 });
    }

    const coder = new BorshAccountsCoder(IDL as any);
    const decodedReceipt: any = coder.decode("BoxReceipt", receiptAcc.data);
    if (!decodedReceipt) {
      return NextResponse.json({ error: "Failed to decode BoxReceipt data." }, { status: 500 });
    }

    const pendingOpens = decodedReceipt.pendingOpens ?? decodedReceipt.pending_opens ?? 0;
    if (pendingOpens === 0) {
      return NextResponse.json({ 
        success: true, 
        alreadyOpened: true, 
        message: "No pending opens. The box has already been revealed." 
      });
    }

    const requestSlot = Number(decodedReceipt.requestSlot ?? decodedReceipt.request_slot ?? 0);

    // 2. Wait for slot to advance if needed
    let currentSlot = await conn.getSlot();
    let slotAttempts = 0;
    while (currentSlot <= requestSlot && slotAttempts < 8) {
      await new Promise(resolve => setTimeout(resolve, 800));
      currentSlot = await conn.getSlot();
      slotAttempts++;
    }

    if (currentSlot <= requestSlot) {
      return NextResponse.json({ error: "Transaction slot has not advanced yet. Please try again in a few seconds." }, { status: 400 });
    }

    // 3. Retrieve request slot hash
    let requestHash = await getSlotHash(conn, requestSlot);
    let hashAttempts = 0;
    while (!requestHash && hashAttempts < 5) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      requestHash = await getSlotHash(conn, requestSlot);
      hashAttempts++;
    }

    if (!requestHash) {
      return NextResponse.json({ error: `Blockhash for slot ${requestSlot} has expired or is not found in SysvarSlotHashes.` }, { status: 404 });
    }

    // 4. Derive other PDAs
    const [platformPda] = await platformPDA();
    const [projectPda] = await projectPDA(slug);
    const [boxConfigPk] = await boxPDA(projectPda, BigInt(boxId));
    const [vaultPda] = await vaultPDA(projectPda);

    // 5. Fetch BoxConfig
    const boxConfigAcc = await conn.getAccountInfo(boxConfigPk);
    if (!boxConfigAcc) {
      return NextResponse.json({ error: "BoxConfig account not found." }, { status: 404 });
    }
    const boxConfig: any = coder.decode("BoxConfig", boxConfigAcc.data);
    if (!boxConfig) {
      return NextResponse.json({ error: "Failed to decode BoxConfig." }, { status: 500 });
    }

    // 6. Fetch configured PrizeItems in a single batch call using getMultipleAccountsInfo (max 20)
    const prizePdas: PublicKey[] = [];
    for (let i = 0; i < 20; i++) {
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("prize"), boxConfigPk.toBuffer(), Buffer.from([i])],
        PROGRAM_ID
      );
      prizePdas.push(pda);
    }

    const prizeAccsInfo = await conn.getMultipleAccountsInfo(prizePdas);
    const boxPrizes: any[] = [];
    for (let i = 0; i < prizePdas.length; i++) {
      const info = prizeAccsInfo[i];
      if (info) {
        try {
          const decodedPrize = coder.decode("PrizeItem", info.data);
          boxPrizes.push({ pubkey: prizePdas[i], index: i, ...decodedPrize });
        } catch {}
      }
    }

    // 7. Emulate deterministic randomness
    const hashInput = Buffer.alloc(112);
    new PublicKey(decodedReceipt.user).toBuffer().copy(hashInput, 0);
    requestHash.copy(hashInput, 32);
    boxConfigPk.toBuffer().copy(hashInput, 64);

    const nonceBuf = Buffer.alloc(8);
    nonceBuf.writeBigUInt64LE(BigInt(decodedReceipt.nonce));
    nonceBuf.copy(hashInput, 96);

    const slotBuf = Buffer.alloc(8);
    slotBuf.writeBigUInt64LE(BigInt(requestSlot));
    slotBuf.copy(hashInput, 104);

    const randomVal = fnv1a(hashInput);

    // 8. Find winning prize index (matches on-chain weights)
    let isWinner = false;
    let wonPrize: any = null;
    let totalWeight = BigInt(0);
    let guaranteedPrize: any = null;

    for (const prize of boxPrizes) {
      const idx = prize.index;
      if (idx < 20) {
        const claimed = (boxConfig.claimedPrizes ?? boxConfig.claimed_prizes)?.[idx] ?? 0;
        const totalCount = prize.totalCount ?? prize.total_count ?? 0;
        const winPercentage = prize.winPercentage ?? prize.win_percentage ?? 0;
        const rem = totalCount - claimed;
        if (rem > 0) {
          totalWeight += BigInt(winPercentage);
          if (winPercentage === 100) {
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
          const claimed = (boxConfig.claimedPrizes ?? boxConfig.claimed_prizes)?.[idx] ?? 0;
          const totalCount = prize.totalCount ?? prize.total_count ?? 0;
          const winPercentage = prize.winPercentage ?? prize.win_percentage ?? 0;
          const rem = totalCount - claimed;
          if (rem > 0) {
            cumulative += BigInt(winPercentage);
            if (prizeRoll < cumulative) {
              isWinner = true;
              wonPrize = prize;
              break;
            }
          }
        }
      }
    }

    // 9. Derive optional token accounts if winner is SPL token/NFT
    let vaultTokenAccount: PublicKey | undefined;
    let userTokenAccount: PublicKey | undefined;
    let tokenProgram: PublicKey | undefined;

    if (isWinner && wonPrize) {
      const prizeTypeRaw = wonPrize.prizeType ?? wonPrize.prize_type;
      let prizeType = "sol";
      if (typeof prizeTypeRaw === "object" && prizeTypeRaw !== null) {
        const keys = Object.keys(prizeTypeRaw).map(k => k.toLowerCase());
        if (keys.includes("spltoken") || keys.includes("token")) prizeType = "spltoken";
        else if (keys.includes("nft")) prizeType = "nft";
      } else if (typeof prizeTypeRaw === "number") {
        if (prizeTypeRaw === 1) prizeType = "spltoken";
        else if (prizeTypeRaw === 2) prizeType = "nft";
      }

      console.log("[RevealAPI] Checking prizeType:", prizeType);
      if (prizeType === "spltoken" || prizeType === "nft") {
        const mintRaw = wonPrize.tokenMint ?? wonPrize.token_mint;
        if (mintRaw) {
          const mintPk = new PublicKey(mintRaw);
          const vaultPk = new PublicKey(vaultPda);
          const userPk = new PublicKey(decodedReceipt.user);
          console.log("[RevealAPI] Debug tokenMint/token_mint:", mintPk.toBase58());
          console.log("[RevealAPI] Debug vaultPda:", vaultPk.toBase58());
          console.log("[RevealAPI] Debug user:", userPk.toBase58());
          vaultTokenAccount = getAssociatedTokenAddressSync(mintPk, vaultPk, true);
          userTokenAccount = getAssociatedTokenAddressSync(mintPk, userPk, true);
          tokenProgram = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
        }
      }
    }

    // 10. Map remaining accounts
    const remainingAccounts = boxPrizes.map(p => ({
      pubkey: p.pubkey,
      isSigner: false,
      isWritable: true
    }));

    // 11. Build reveal_open instruction
    const ix = buildIx("reveal_open", {
      platform:       { pubkey: platformPda,             isSigner: false, isWritable: false },
      project:        { pubkey: projectPda,              isSigner: false, isWritable: false },
      box_config:     { pubkey: boxConfigPk,             isSigner: false, isWritable: true  },
      receipt:        { pubkey: receiptPk,               isSigner: false, isWritable: true  },
      vault:          { pubkey: vaultPda,                isSigner: false, isWritable: true  },
      user:           { pubkey: new PublicKey(decodedReceipt.user), isSigner: false, isWritable: true },
      keeper:         { pubkey: keeper.publicKey,        isSigner: true,  isWritable: true  },
      system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      slot_hashes:    { pubkey: new PublicKey("SysvarS1otHashes111111111111111111111111111"), isSigner: false, isWritable: false },
      ...(vaultTokenAccount ? { vault_token_account: { pubkey: vaultTokenAccount, isSigner: false, isWritable: true } } : {}),
      ...(userTokenAccount ? { user_token_account: { pubkey: userTokenAccount, isSigner: false, isWritable: true } } : {}),
      ...(tokenProgram ? { token_program: { pubkey: tokenProgram, isSigner: false, isWritable: false } } : {}),
    }, [slug, Number(boxId)], remainingAccounts);

    // 12. Create, sign and send transaction
    const tx = new Transaction().add(ix);
    tx.feePayer = keeper.publicKey;
    
    // Get recent blockhash with exponential backoff
    let blockhash: string;
    let recentBlockhashAttempts = 0;
    while (recentBlockhashAttempts < 5) {
      try {
        blockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
        break;
      } catch {
        recentBlockhashAttempts++;
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }
    tx.recentBlockhash = blockhash!;
    tx.sign(keeper);

    const serializedTx = tx.serialize();
    const signature = await conn.sendRawTransaction(serializedTx, {
      skipPreflight: false,
      preflightCommitment: "confirmed"
    });

    console.log(`[RevealAPI] Reveal open broadcasted. Sig: ${signature}`);

    await conn.confirmTransaction(signature, "confirmed");

    // Retrieve full transaction logs
    let txDetails: any = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        txDetails = await conn.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0
        });
        if (txDetails) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const logs = txDetails?.meta?.logMessages || [];

    return NextResponse.json({
      success: true,
      signature,
      logs
    });
  } catch (err: any) {
    console.log("[RevealAPI] Error processing reveal_open stack:", err.stack || err);
    return NextResponse.json({ error: err.message || String(err), stack: err.stack }, { status: 500 });
  }
}
