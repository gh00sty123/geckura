import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { buildIx, sendIx, sendTx, platformPDA, projectPDA, boxPDA, vaultPDA, ixCloseBox, ixClosePrizeItem, ixCloseProject, PROGRAM_ID, buildConn, retryWithBackoff, decodeAccount } from "@/lib/program-ix";
import { createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { WalletContextState } from "@solana/wallet-adapter-react";

// Constants for token and associated token programs
const TOKEN_PROG = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROG = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** All wallet-based tx helpers receive WalletContextState (useWallet return)
 *  and pass it to sendIx, which calls wallet.signTransaction to trigger the
 *  extension's approval popup.  Type safety ensures callers pass real wallet. */
type WalletState = WalletContextState;

export const createProjectTx = async (
  wallet: WalletState,
  params: {
    slug: string;
    authority: PublicKey;
    feeWallet: PublicKey;
    feeWallet2: PublicKey;
    feeLamports: number;
    solRankingPoints: number;
    tokenRankingPoints: number;
    rentClaimMode: number;
  }
) => {
  const [platformPda] = await platformPDA();
  const [projectPda] = await projectPDA(params.slug);

  const ix = buildIx("create_project", {
    platform: { pubkey: platformPda, isSigner: false, isWritable: true },
    project: { pubkey: projectPda, isSigner: false, isWritable: true },
    super_admin: { pubkey: wallet.publicKey!, isSigner: true, isWritable: false },
    system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  }, [
    params.slug,
    params.authority,
    params.feeWallet,
    params.feeWallet2,
    params.feeLamports,
    params.rentClaimMode,
  ]);

  await sendIx(ix, wallet);
};

export const updateProjectFeesTx = async (
  wallet: WalletState,
  slug: string,
  feeWallet: PublicKey,
  feeWallet2: PublicKey,
  feeLamports: number
) => {
  const [platformPda] = await platformPDA();
  const [projectPda] = await projectPDA(slug);

  const ix = buildIx("update_project_fees", {
    platform: { pubkey: platformPda, isSigner: false, isWritable: true },
    project: { pubkey: projectPda, isSigner: false, isWritable: true },
    super_admin: { pubkey: wallet.publicKey!, isSigner: true, isWritable: false },
  }, [slug, feeLamports, feeWallet, feeWallet2]);

  await sendIx(ix, wallet);
};

export const createBoxTx = async (
  wallet: WalletState,
  params: {
    slug: string;
    boxId: number;
    priceLamports: number;
    acceptedMints: PublicKey[];
    acceptedPrices: number[];
    supply: number;
    startTime: number;
    endTime: number;
  }
) => {
  const [platformPda] = await platformPDA();
  const [projectPda] = await projectPDA(params.slug);
  const [boxConfigPda] = await boxPDA(
    projectPda,
    params.boxId
  );

  // Ensure arrays are of length 3
  const mints = [...params.acceptedMints];
  while (mints.length < 3) mints.push(PublicKey.default);
  const prices = [...params.acceptedPrices];
  while (prices.length < 3) prices.push(0);

  const ix = buildIx("create_box", {
    platform: { pubkey: platformPda, isSigner: false, isWritable: false },
    project: { pubkey: projectPda, isSigner: false, isWritable: false },
    box_config: { pubkey: boxConfigPda, isSigner: false, isWritable: true },
    tenant: { pubkey: wallet.publicKey!,  isSigner: true, isWritable: false },
    system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  }, [
    params.slug,
    params.boxId,
    params.priceLamports,
    mints,
    prices,
    params.supply,
    params.startTime,
    params.endTime
  ]);

  await sendIx(ix, wallet);
};

export const createPrizeItemTx = async (
  wallet: WalletState,
  params: {
    slug: string;
    boxId: number;
    prizeIndex: number;
    prizeType: "Sol" | "SplToken" | "Nft";
    tokenMint: PublicKey;
    amount: number;
    winPercentage: number;
    totalCount: number;
  }
) => {
  const [platformPda] = await platformPDA();
  const [projectPda] = await projectPDA(params.slug);
  const [boxConfigPda] = await boxPDA(
    projectPda,
    params.boxId
  );
  const prizeItemPda = PublicKey.findProgramAddressSync(
    [Buffer.from("prize"), boxConfigPda.toBuffer(), Buffer.from([params.prizeIndex])],
    new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4")
  )[0];

  const ix = buildIx("create_prize_item", {
    project: { pubkey: projectPda, isSigner: false, isWritable: false },
    box_config: { pubkey: boxConfigPda, isSigner: false, isWritable: true },
    prize_item: { pubkey: prizeItemPda, isSigner: false, isWritable: true },
    tenant: { pubkey: wallet.publicKey!, isSigner: true, isWritable: true },
    system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  }, [
    params.slug,
    params.boxId,
    params.prizeIndex,
    params.prizeType,
    params.tokenMint,
    params.amount,
    params.winPercentage,
    params.totalCount
  ]);

  await sendIx(ix, wallet);
};

export const createBoxWithPrizesTx = async (
  wallet: WalletState,
  params: {
    box: {
      slug: string;
      boxId: number;
      priceLamports: number;
      acceptedMints: PublicKey[];
      acceptedPrices: number[];
      supply: number;
      startTime: number;
      endTime: number;
    };
    prizes: {
      prizeIndex: number;
      prizeType: "Sol" | "SplToken" | "Nft";
      tokenMint: PublicKey;
      amount: number;
      winPercentage: number;
      totalCount: number;
    }[];
  }
) => {
  const [platformPda] = await platformPDA();
  const [projectPda] = await projectPDA(params.box.slug);
  const [boxConfigPda] = await boxPDA(
    projectPda,
    params.box.boxId
  );

  // Ensure arrays are of length 3
  const mints = [...params.box.acceptedMints];
  while (mints.length < 3) mints.push(PublicKey.default);
  const prices = [...params.box.acceptedPrices];
  while (prices.length < 3) prices.push(0);

  // Create Box Instruction
  const boxIx = buildIx("create_box", {
    platform: { pubkey: platformPda, isSigner: false, isWritable: false },
    project: { pubkey: projectPda, isSigner: false, isWritable: false },
    box_config: { pubkey: boxConfigPda, isSigner: false, isWritable: true },
    tenant: { pubkey: wallet.publicKey!,  isSigner: true, isWritable: false },
    system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  }, [
    params.box.slug,
    params.box.boxId,
    params.box.priceLamports,
    mints,
    prices,
    params.box.supply,
    params.box.startTime,
    params.box.endTime
  ]);

  // Split prizes into batches of 4 to prevent exceeding Solana's 1232-byte transaction limit
  const batchSize = 4;
  const prizeBatches = [];
  for (let i = 0; i < params.prizes.length; i += batchSize) {
    prizeBatches.push(params.prizes.slice(i, i + batchSize));
  }

  // 1. Transaction 1: Create Box + First Batch of Prizes
  const tx1 = new Transaction();
  tx1.add(boxIx);

  const firstBatch = prizeBatches[0] || [];
  for (const prize of firstBatch) {
    const prizeItemPda = PublicKey.findProgramAddressSync(
      [Buffer.from("prize"), boxConfigPda.toBuffer(), Buffer.from([prize.prizeIndex])],
      PROGRAM_ID
    )[0];

    const prizeIx = buildIx("create_prize_item", {
      project: { pubkey: projectPda, isSigner: false, isWritable: false },
      box_config: { pubkey: boxConfigPda, isSigner: false, isWritable: true },
      prize_item: { pubkey: prizeItemPda, isSigner: false, isWritable: true },
      tenant: { pubkey: wallet.publicKey!, isSigner: true, isWritable: true },
      system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    }, [
      params.box.slug,
      params.box.boxId,
      prize.prizeIndex,
      prize.prizeType,
      prize.tokenMint,
      prize.amount,
      prize.winPercentage,
      prize.totalCount
    ]);
    tx1.add(prizeIx);
  }

  await sendTx(tx1, wallet);

  // 2. Subsequent transactions: Remaining prizes in batches of 4
  for (let b = 1; b < prizeBatches.length; b++) {
    const tx = new Transaction();
    for (const prize of prizeBatches[b]) {
      const prizeItemPda = PublicKey.findProgramAddressSync(
        [Buffer.from("prize"), boxConfigPda.toBuffer(), Buffer.from([prize.prizeIndex])],
        PROGRAM_ID
      )[0];

      const prizeIx = buildIx("create_prize_item", {
        project: { pubkey: projectPda, isSigner: false, isWritable: false },
        box_config: { pubkey: boxConfigPda, isSigner: false, isWritable: true },
        prize_item: { pubkey: prizeItemPda, isSigner: false, isWritable: true },
        tenant: { pubkey: wallet.publicKey!, isSigner: true, isWritable: true },
        system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      }, [
        params.box.slug,
        params.box.boxId,
        prize.prizeIndex,
        prize.prizeType,
        prize.tokenMint,
        prize.amount,
        prize.winPercentage,
        prize.totalCount
      ]);
      tx.add(prizeIx);
    }
    await sendTx(tx, wallet);
  }
};


export const depositPrizeTx = async (
  wallet: WalletState,
  params: {
    slug: string;
    boxId: number;
    prizeIndex: number;
    tokenMint: PublicKey;
    amount: number;
  }
) => {
  const [projectPda] = await projectPDA(params.slug);
  const [boxConfigPda] = await boxPDA(
    projectPda,
    params.boxId
  );
  const prizeItemPda = PublicKey.findProgramAddressSync(
    [Buffer.from("prize"), boxConfigPda.toBuffer(), Buffer.from([params.prizeIndex])],
    new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4")
  )[0];
  const [vaultPda] = await vaultPDA(projectPda);
  const vaultAta = PublicKey.findProgramAddressSync(
    [vaultPda.toBuffer(), TOKEN_PROG.toBuffer(), params.tokenMint.toBuffer()],
    ATA_PROG
  )[0];
  const signerAta = PublicKey.findProgramAddressSync(
    [wallet.publicKey!.toBuffer(), TOKEN_PROG.toBuffer(), params.tokenMint.toBuffer()],
    ATA_PROG
  )[0];

  const ix = buildIx("manage_prize", {
    project: { pubkey: projectPda, isSigner: false, isWritable: false },
    box_config: { pubkey: boxConfigPda, isSigner: false, isWritable: true },
    prize_item: { pubkey: prizeItemPda, isSigner: false, isWritable: true },
    vault: { pubkey: vaultPda, isSigner: false, isWritable: false },
    token_mint: { pubkey: params.tokenMint, isSigner: false, isWritable: false },
    tenant_token_account: { pubkey: signerAta, isSigner: false, isWritable: true },
    vault_token_account: { pubkey: vaultAta, isSigner: false, isWritable: true },
    tenant: { pubkey: wallet.publicKey!,  isSigner: true, isWritable: true },
    token_program: { pubkey: TOKEN_PROG, isSigner: false, isWritable: false },
    associated_token_program: { pubkey: ATA_PROG, isSigner: false, isWritable: false },
    system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  }, [
    params.slug,
    params.prizeIndex,
    params.boxId,
    { deposit: {} },
    params.amount
  ]);

  await sendIx(ix, wallet);
};

export const withdrawPrizeTx = async (
  wallet: WalletState,
  params: {
    slug: string;
    boxId: number;
    prizeIndex: number;
    tokenMint: PublicKey;
  }
) => {
  const [projectPda] = await projectPDA(params.slug);
  const [boxConfigPda] = await boxPDA(
    projectPda,
    params.boxId
  );
  const prizeItemPda = PublicKey.findProgramAddressSync(
    [Buffer.from("prize"), boxConfigPda.toBuffer(), Buffer.from([params.prizeIndex])],
    new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4")
  )[0];
  const [vaultPda] = await vaultPDA(projectPda);
  const vaultAta = PublicKey.findProgramAddressSync(
    [vaultPda.toBuffer(), TOKEN_PROG.toBuffer(), params.tokenMint.toBuffer()],
    ATA_PROG
  )[0];
  const signerAta = PublicKey.findProgramAddressSync(
    [wallet.publicKey!.toBuffer(), TOKEN_PROG.toBuffer(), params.tokenMint.toBuffer()],
    ATA_PROG
  )[0];

  const ix = buildIx("manage_prize", {
    project: { pubkey: projectPda, isSigner: false, isWritable: false },
    box_config: { pubkey: boxConfigPda, isSigner: false, isWritable: true },
    prize_item: { pubkey: prizeItemPda, isSigner: false, isWritable: true },
    vault: { pubkey: vaultPda, isSigner: false, isWritable: false },
    token_mint: { pubkey: params.tokenMint, isSigner: false, isWritable: false },
    tenant_token_account: { pubkey: signerAta, isSigner: false, isWritable: true },
    vault_token_account: { pubkey: vaultAta, isSigner: false, isWritable: true },
    tenant: { pubkey: wallet.publicKey!,  isSigner: true, isWritable: true },
    token_program: { pubkey: TOKEN_PROG, isSigner: false, isWritable: false },
    associated_token_program: { pubkey: ATA_PROG, isSigner: false, isWritable: false },
    system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  }, [
    params.slug,
    params.prizeIndex,
    params.boxId,
    { withdraw: {} },
    0
  ]);

  await sendIx(ix, wallet);
};

export const updateBoxTx = async (
  wallet: WalletState,
  params: {
    slug: string;
    boxId: number;
    priceLamports: number;
    acceptedMints: PublicKey[];
    acceptedPrices: number[];
    startTime: number;
    endTime: number;
  }
) => {
  const [projectPda] = await projectPDA(params.slug);
  const [boxConfigPda] = await boxPDA(
    projectPda,
    params.boxId
  );

  // Ensure arrays are of length 3
  const mints = [...params.acceptedMints];
  while (mints.length < 3) mints.push(PublicKey.default);
  const prices = [...params.acceptedPrices];
  while (prices.length < 3) prices.push(0);

  const ix = buildIx("update_box", {
    project: { pubkey: projectPda, isSigner: false, isWritable: false },
    box_config: { pubkey: boxConfigPda, isSigner: false, isWritable: true },
    tenant: { pubkey: wallet.publicKey!,  isSigner: true, isWritable: false },
  }, [
    params.slug,
    params.boxId,
    params.priceLamports,
    mints,
    prices,
    params.startTime,
    params.endTime
  ]);

  await sendIx(ix, wallet);
};

export const closeBoxTx = async (
  wallet: WalletState,
  params: {
    slug: string;
    boxId: number;
    rentDestination?: PublicKey;
  }
) => {
  const [platformPda] = await platformPDA();
  const [projectPda] = await projectPDA(params.slug);
  const [boxConfigPda] = await boxPDA(
    projectPda,
    params.boxId
  );

  const rentDest = params.rentDestination || wallet.publicKey!;

  const ix = buildIx("close_box", {
    platform: { pubkey: platformPda, isSigner: false, isWritable: false },
    project: { pubkey: projectPda, isSigner: false, isWritable: false },
    box_config: { pubkey: boxConfigPda, isSigner: false, isWritable: true },
    signer: { pubkey: wallet.publicKey!, isSigner: true, isWritable: false },
    rent_destination: { pubkey: rentDest, isSigner: false, isWritable: true },
  }, [
    params.slug,
    params.boxId
  ]);

  await sendIx(ix, wallet);
};

export const withdrawVaultSolTx = async (
  wallet: WalletState,
  params: {
    slug: string;
    amountLamports: number;
  }
) => {
  const [projectPda] = await projectPDA(params.slug);
  const [vaultPda] = await vaultPDA(projectPda);

  const ix = buildIx("withdraw_vault_sol", {
    project: { pubkey: projectPda, isSigner: false, isWritable: false },
    vault: { pubkey: vaultPda, isSigner: false, isWritable: true },
    authority: { pubkey: wallet.publicKey!, isSigner: true, isWritable: true },
    system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  }, [
    params.slug,
    params.amountLamports
  ]);

  await sendIx(ix, wallet);
};

export const withdrawVaultTokenTx = async (
  wallet: WalletState,
  params: {
    slug: string;
    tokenMint: PublicKey;
    amount: number;
  }
) => {
  const [projectPda] = await projectPDA(params.slug);
  const [vaultPda] = await vaultPDA(projectPda);
  const vaultAta = PublicKey.findProgramAddressSync(
    [vaultPda.toBuffer(), TOKEN_PROG.toBuffer(), params.tokenMint.toBuffer()],
    ATA_PROG
  )[0];
  const signerAta = PublicKey.findProgramAddressSync(
    [wallet.publicKey!.toBuffer(), TOKEN_PROG.toBuffer(), params.tokenMint.toBuffer()],
    ATA_PROG
  )[0];

  const conn = buildConn();
  const tx = new Transaction();

  // Create authority ATA if not exists
  const signerAtaInfo = await conn.getAccountInfo(signerAta);
  if (!signerAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey!,
        signerAta,
        wallet.publicKey!,
        params.tokenMint
      )
    );
  }

  const ix = buildIx("withdraw_vault_token", {
    project: { pubkey: projectPda, isSigner: false, isWritable: false },
    vault: { pubkey: vaultPda, isSigner: false, isWritable: true },
    token_mint: { pubkey: params.tokenMint, isSigner: false, isWritable: false },
    vault_token_account: { pubkey: vaultAta, isSigner: false, isWritable: true },
    authority_token_account: { pubkey: signerAta, isSigner: false, isWritable: true },
    authority: { pubkey: wallet.publicKey!, isSigner: true, isWritable: true },
    token_program: { pubkey: TOKEN_PROG, isSigner: false, isWritable: false },
    associated_token_program: { pubkey: ATA_PROG, isSigner: false, isWritable: false },
    system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  }, [
    params.slug,
    params.amount
  ]);
  tx.add(ix);

  await sendTx(tx, wallet);
};

export const closeVaultTokenAccountTx = async (
  wallet: WalletState,
  params: {
    slug: string;
    tokenMint: PublicKey;
  }
) => {
  throw new Error("Closing vault token accounts is no longer supported on-chain to minimize contract size. You can withdraw all tokens to a zero balance.");
};

export const updateProjectBrandingTx = async (
  wallet: WalletState,
  params: {
    slug: string;
    name: string;
    logoUri: string;
    bgUri: string;
    description: string;
    themeColor: string;
    navbarColor?: string;
    textColor?: string;
    solRankingPoints: number;
    tokenRankingPoints: number;
    nothingRewardImage?: string;
    twitterUsername?: string;
    twitterLink?: string;
  }
) => {
  if (!wallet.publicKey || !wallet.signMessage) {
    throw new Error("Wallet must be connected and support message signing.");
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const messageStr = `Update branding for ${params.slug} at ${timestamp}`;
  const messageBytes = new TextEncoder().encode(messageStr);
  const signatureBytes = await wallet.signMessage(messageBytes);
  const signatureB64 = Buffer.from(signatureBytes).toString("base64");

  const res = await fetch("/api/branding", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Branding-Signature": signatureB64,
      "X-Branding-Signer": wallet.publicKey.toBase58(),
      "X-Branding-Timestamp": String(timestamp),
    },
    body: JSON.stringify({
      slug: params.slug,
      name: params.name,
      logoUri: params.logoUri,
      bgUri: params.bgUri,
      description: params.description,
      themeColor: params.themeColor,
      navbarColor: params.navbarColor || "",
      textColor: params.textColor || "",
      nothingRewardImage: params.nothingRewardImage || "",
      twitterUsername: params.twitterUsername || "",
      twitterLink: params.twitterLink || "",
    }),
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error || `Server responded with status ${res.status}`);
  }
};

export const updateBoxBrandingTx = async (
  wallet: WalletState,
  params: {
    slug: string;
    boxId: number;
    name: string;
    description: string;
    bannerUri: string;
  }
) => {
  if (!wallet.publicKey || !wallet.signMessage) {
    throw new Error("Wallet must be connected and support message signing.");
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const messageStr = `Update box branding for ${params.slug} box ${params.boxId} at ${timestamp}`;
  const messageBytes = new TextEncoder().encode(messageStr);
  const signatureBytes = await wallet.signMessage(messageBytes);
  const signatureB64 = Buffer.from(signatureBytes).toString("base64");

  const res = await fetch("/api/branding/box", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Branding-Signature": signatureB64,
      "X-Branding-Signer": wallet.publicKey.toBase58(),
      "X-Branding-Timestamp": String(timestamp),
    },
    body: JSON.stringify({
      slug: params.slug,
      boxId: params.boxId,
      name: params.name,
      description: params.description,
      bannerUri: params.bannerUri,
    }),
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error || `Server responded with status ${res.status}`);
  }
};

export const migrateProjectToV2Tx = async (
  wallet: WalletState,
  params: {
    slug: string;
    bump: number;
    name: string;
    description: string;
    logoUri: string;
    bgUri: string;
    themeColor: string;
  }
) => {
  await updateProjectBrandingTx(wallet, {
    ...params,
    solRankingPoints: 0,
    tokenRankingPoints: 0,
  });
};

/** Info about a single box that can be swept for rent */
export interface SweepableBox {
  boxId: number;
  boxName: string;
  boxPubkey: string;
  boxLamports: number;
  prizeItems: { pubkey: string; index: number; lamports: number }[];
  totalLamports: number;
  sold: number;
  supply: number;
  status: number;
  endTime: number;
}

/** Per-project rent summary */
export interface ProjectRentInfo {
  slug: string;
  projectPubkey: string;
  sweepableBoxes: SweepableBox[];
  totalRentLamports: number;
}

/**
 * Fetch rent info for a single project.
 * Returns all boxes that are ended/sold-out + their prize items with lamport balances.
 */
export const fetchRentInfoForProject = async (
  slug: string,
  allBoxes: any[],
  allPrizeItems: any[],
): Promise<ProjectRentInfo> => {
  const [projectPda] = await projectPDA(slug);
  const projectPubkey = projectPda.toBase58();

  // Filter boxes belonging to this project
  const projectBoxes = allBoxes.filter((box) => {
    const boxProject = box.project?.toBase58?.() ?? box.project;
    return boxProject === projectPubkey;
  });

  // Only sweepable boxes: ended OR sold out, AND past end_time
  const now = Math.floor(Date.now() / 1000);
  const sweepableBoxes: SweepableBox[] = [];

  const conn = buildConn();

  for (const box of projectBoxes) {
    const isEnded = box.status === 2 || now > box.endTime;
    const isSoldOut = box.sold >= box.supply;
    if (!isEnded && !isSoldOut) continue;

    // Fetch actual lamports for the box PDA
    const boxPk = typeof box.pubkey === "string" ? new PublicKey(box.pubkey) : box.pubkey;
    const boxAccInfo = await retryWithBackoff(
      () => conn.getAccountInfo(boxPk),
      `getAccountInfo(box-${box.boxId})`
    ).catch(() => null);

    if (!boxAccInfo) continue; // Already closed

    const boxLamports = boxAccInfo.lamports;

    // Find prize items for this box
    const boxPubkeyStr = boxPk.toBase58();
    const boxPrizeItems = allPrizeItems.filter((pi) => {
      const piBox = pi.boxConfig?.toBase58?.() ?? pi.boxConfig;
      return piBox === boxPubkeyStr;
    });

    // Fetch lamports for each prize item
    const prizeItemInfos: { pubkey: string; index: number; lamports: number }[] = [];
    for (const pi of boxPrizeItems) {
      const piPk = typeof pi.pubkey === "string" ? new PublicKey(pi.pubkey) : pi.pubkey;
      const piAccInfo = await retryWithBackoff(
        () => conn.getAccountInfo(piPk),
        `getAccountInfo(prize-${pi.index})`
      ).catch(() => null);
      if (piAccInfo) {
        prizeItemInfos.push({
          pubkey: piPk.toBase58(),
          index: pi.index,
          lamports: piAccInfo.lamports,
        });
      }
    }

    const totalLamports = boxLamports + prizeItemInfos.reduce((s, p) => s + p.lamports, 0);

    sweepableBoxes.push({
      boxId: box.boxId,
      boxName: box.name,
      boxPubkey: boxPubkeyStr,
      boxLamports,
      prizeItems: prizeItemInfos,
      totalLamports,
      sold: box.sold,
      supply: box.supply,
      status: box.status,
      endTime: box.endTime,
    });
  }

  return {
    slug,
    projectPubkey,
    sweepableBoxes,
    totalRentLamports: sweepableBoxes.reduce((s, b) => s + b.totalLamports, 0),
  };
};

/**
 * Admin sweep: close all prize items + the box config for one sweepable box,
 * recovering rent to `rentReceiver`.
 * Returns the transaction signature.
 */
export const adminSweepBoxRentTx = async (
  wallet: WalletState,
  params: {
    slug: string;
    boxId: number;
    prizeIndices: number[];
    rentReceiver: PublicKey;
  }
): Promise<string> => {
  const [platformPda] = await platformPDA();
  const [projectPda] = await projectPDA(params.slug);
  const [boxConfigPda] = await boxPDA(projectPda, params.boxId);

  const conn = buildConn();
  const tx = new Transaction();

  // 1. Close each prize item first (box must exist for seeds to resolve)
  for (const prizeIndex of params.prizeIndices) {
    const prizeItemPda = PublicKey.findProgramAddressSync(
      [Buffer.from("prize"), boxConfigPda.toBuffer(), Buffer.from([prizeIndex])],
      PROGRAM_ID
    )[0];

    const ix = ixClosePrizeItem(
      platformPda,
      projectPda,
      boxConfigPda,
      prizeItemPda,
      wallet.publicKey!,
      params.rentReceiver,
      params.slug,
      params.boxId,
      prizeIndex,
    );
    tx.add(ix);
  }

  // 2. Close the box config last
  const boxIx = ixCloseBox(
    platformPda,
    projectPda,
    boxConfigPda,
    wallet.publicKey!,
    params.rentReceiver,
    params.slug,
    params.boxId,
  );
  tx.add(boxIx);

  // Sign & send
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  if (!wallet.signTransaction) throw new Error("Wallet not ready");

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (
    await retryWithBackoff(() => conn.getLatestBlockhash(), "getLatestBlockhash(sweep)")
  ).blockhash;

  const signed = await wallet.signTransaction(tx as any);
  const sig = await retryWithBackoff(
    () => conn.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    }),
    "sendRawTransaction(sweep)"
  );
  await retryWithBackoff(
    () => conn.confirmTransaction(sig, "confirmed"),
    "confirmTransaction(sweep)"
  );
  return sig;
};

export const closeProjectTx = async (
  wallet: WalletState,
  slug: string,
) => {
  const [platformPda] = await platformPDA();
  const [projectPda] = await projectPDA(slug);

  const ix = ixCloseProject(platformPda, projectPda, wallet.publicKey!, slug);
  await sendIx(ix, wallet);
};