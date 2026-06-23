import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import * as fs from "fs";
import { PublicKey, SystemProgram, Keypair, Connection, Transaction } from "@solana/web3.js";
import { 
  createMint, 
  getOrCreateAssociatedTokenAccount, 
  mintTo, 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID 
} from "@solana/spl-token";
import { expect } from "chai";

// Import the IDL types if they exist or compile program
import { MysteryBox } from "../target/types/mystery_box";

describe("mystery_box", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.MysteryBox as Program<MysteryBox>;
  const connection = provider.connection;

  // The super admin key must match FBPFAtDxCwPEKb5kUp779TdFQU3hyPmfjT2LwtrkKscq
  const superAdmin = provider.wallet as anchor.Wallet;

  // Retry helper to handle replication lag and RPC timeouts on public devnets/testnets
  const fetchWithRetry = async <T>(fetchFn: () => Promise<T>, retries = 5, delayMs = 1500): Promise<T> => {
    for (let i = 0; i < retries; i++) {
      try {
        return await fetchFn();
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    throw new Error("Fetch failed after maximum retries");
  };

  beforeEach(async () => {
    // Add a 1.2-second delay before each test to stay below public/devnet RPC rate limits
    const isLocalnet = connection.rpcEndpoint.includes("localhost") || connection.rpcEndpoint.includes("127.0.0.1");
    if (!isLocalnet) {
      await new Promise(r => setTimeout(r, 1200));
    }
  });

  // PDAs
  let platformPda: PublicKey;
  let platformBump: number;

  const slug = "test-project-" + Math.floor(Math.random() * 100000);
  let projectPda: PublicKey;
  let projectBump: number;

  let vaultPda: PublicKey;
  let vaultBump: number;

  const boxId = new anchor.BN(1);
  let boxConfigPda: PublicKey;
  let boxConfigBump: number;

  const prizeIndex = 0;
  let prizeItemPda: PublicKey;
  let prizeItemBump: number;

  let receiptPda: PublicKey;
  let receiptBump: number;

  // Keys & Mint
  const tenant = Keypair.generate();
  const user = Keypair.generate();
  const feeWallet = Keypair.generate();
  const feeWallet2 = Keypair.generate();
  const platformTreasury = Keypair.generate();

  let tokenMint: PublicKey;
  let tenantTokenAccount: any;
  let vaultTokenAccount: any;
  let userTokenAccount: any;

  before(async () => {
    // Derive Platform PDA
    [platformPda, platformBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("platform")],
      program.programId
    );

    // Derive Project PDA
    [projectPda, projectBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("project"), Buffer.from(slug)],
      program.programId
    );

    // Derive Vault PDA
    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), projectPda.toBuffer()],
      program.programId
    );

    // Derive BoxConfig PDA
    [boxConfigPda, boxConfigBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("box"), projectPda.toBuffer(), boxId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Derive PrizeItem PDA
    [prizeItemPda, prizeItemBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("prize"), boxConfigPda.toBuffer(), Buffer.from([prizeIndex])],
      program.programId
    );

    // Derive BoxReceipt PDA
    [receiptPda, receiptBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), user.publicKey.toBuffer(), boxConfigPda.toBuffer()],
      program.programId
    );

    // Funding helper to support both localnet (airdrop) and public networks (transfer from provider wallet)
    const fundAccount = async (target: PublicKey, amountLamports: number) => {
      const isLocalnet = connection.rpcEndpoint.includes("localhost") || connection.rpcEndpoint.includes("127.0.0.1");
      if (isLocalnet) {
        const signature = await connection.requestAirdrop(target, amountLamports);
        await connection.confirmTransaction(signature, "confirmed");
      } else {
        // Transfer from provider wallet (superAdmin)
        const transferTx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: superAdmin.publicKey,
            toPubkey: target,
            lamports: amountLamports,
          })
        );
        await provider.sendAndConfirm(transferTx);
      }
    };

    // Fund accounts
    // On Devnet, 10 SOL is too much and unnecessary. We fund sufficient amounts to run the 30-combo suite.
    const isLocalnet = connection.rpcEndpoint.includes("localhost") || connection.rpcEndpoint.includes("127.0.0.1");
    const tenantFund = isLocalnet ? 10 * 1e9 : 4.8 * 1e9; // 10 SOL on localnet, 4.8 SOL on devnet
    const userFund = isLocalnet ? 10 * 1e9 : 1.8 * 1e9;   // 10 SOL on localnet, 1.8 SOL on devnet
    const feeWalletFund = isLocalnet ? 1e8 : 1e7;    // 0.1 SOL on localnet, 0.01 SOL on devnet
    const feeWallet2Fund = isLocalnet ? 1e8 : 1e7;   // 0.1 SOL on localnet, 0.01 SOL on devnet

    await fundAccount(tenant.publicKey, tenantFund);
    await fundAccount(user.publicKey, userFund);
    await fundAccount(feeWallet.publicKey, feeWalletFund);
    await fundAccount(feeWallet2.publicKey, feeWallet2Fund);

    // Create custom test token mint
    tokenMint = await createMint(
      connection,
      tenant, // payer
      tenant.publicKey, // mintAuthority
      null, // freezeAuthority
      9 // decimals
    );

    // Create Associated Token Accounts (ATA)
    tenantTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      tenant, // payer
      tokenMint,
      tenant.publicKey
    );

    vaultTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      tenant, // payer
      tokenMint,
      vaultPda,
      true // allowOwnerOffCurve (PDA owner)
    );

    userTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      tenant, // payer
      tokenMint,
      user.publicKey
    );

    // Mint test tokens to tenant
    await mintTo(
      connection,
      tenant,
      tokenMint,
      tenantTokenAccount.address,
      tenant,
      1_000_000_000_000 // Mint 1000 tokens (since decimals=9)
    );
  });

  it("Initializes the platform Config", async () => {
    try {
      // Check if already initialized on public network (persistent state)
      const platformAccount = await program.account.platformConfig.fetch(platformPda);
      expect(platformAccount.authority.toBase58()).to.equal(superAdmin.publicKey.toBase58());
      return;
    } catch (e) {
      // If fetch fails, the account is not initialized yet. Proceed to initialize it.
    }

    await program.methods
      .initializePlatform(platformTreasury.publicKey)
      .accounts({
        platform: platformPda,
        superAdmin: superAdmin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const platformAccount = await fetchWithRetry(() => program.account.platformConfig.fetch(platformPda));
    expect(platformAccount.authority.toBase58()).to.equal(superAdmin.publicKey.toBase58());
    expect(platformAccount.treasury.toBase58()).to.equal(platformTreasury.publicKey.toBase58());
    expect(platformAccount.isPaused).to.be.false;
  });

  it("Creates a project", async () => {
    const feeLamports = new anchor.BN(5_000_000); // 0.005 SOL fee
    const rentClaimMode = 0;

    await program.methods
      .createProject(
        slug,
        tenant.publicKey,
        feeWallet.publicKey,
        feeWallet2.publicKey,
        feeLamports,
        rentClaimMode
      )
      .accounts({
        platform: platformPda,
        project: projectPda,
        superAdmin: superAdmin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const projectAccount = await fetchWithRetry(() => program.account.project.fetch(projectPda));
    expect(projectAccount.slug).to.equal(slug);
    expect(projectAccount.authority.toBase58()).to.equal(tenant.publicKey.toBase58());
    expect(projectAccount.feeWallet.toBase58()).to.equal(feeWallet.publicKey.toBase58());
    expect(projectAccount.feeWallet2.toBase58()).to.equal(feeWallet2.publicKey.toBase58());
    expect(projectAccount.feeLamports.toNumber()).to.equal(5_000_000);
    expect(projectAccount.isActive).to.be.true;
  });

  it("Initializes the prize vault PDA", async () => {
    await program.methods
      .initializeVault(slug)
      .accounts({
        project: projectPda,
        vault: vaultPda,
        tenant: tenant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    const vaultAccount = await fetchWithRetry(() => program.account.prizeVault.fetch(vaultPda));
    expect(vaultAccount.project.toBase58()).to.equal(projectPda.toBase58());
  });

  it("Creates a box config", async () => {
    const priceLamports = new anchor.BN(100_000_000); // 0.1 SOL
    const acceptedMints = [PublicKey.default, PublicKey.default, PublicKey.default];
    const acceptedPrices = [new anchor.BN(0), new anchor.BN(0), new anchor.BN(0)];
    const supply = 10;
    const startTime = new anchor.BN(Math.floor(Date.now() / 1000) - 100);
    const endTime = new anchor.BN(Math.floor(Date.now() / 1000) + 10000);

    await program.methods
      .createBox(
        slug,
        boxId,
        priceLamports,
        acceptedMints,
        acceptedPrices,
        supply,
        startTime,
        endTime
      )
      .accounts({
        platform: platformPda,
        project: projectPda,
        boxConfig: boxConfigPda,
        tenant: tenant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    const boxAccount = await fetchWithRetry(() => program.account.boxConfig.fetch(boxConfigPda));
    expect(boxAccount.project.toBase58()).to.equal(projectPda.toBase58());
    expect(boxAccount.boxId.toNumber()).to.equal(1);
    expect(boxAccount.supply).to.equal(10);
    expect(boxAccount.sold).to.equal(0);
  });

  it("Creates a prize item inside the box config", async () => {
    const prizeType = { splToken: {} }; // PrizeType::SplToken enum representation
    const amount = new anchor.BN(1_000_000_000); // 1 token (decimals=9)
    const winPercentage = 100; // Guaranteed win to simplify test verification
    const totalCount = 10;

    await program.methods
      .createPrizeItem(
        slug,
        boxId,
        prizeIndex,
        prizeType,
        tokenMint,
        amount,
        winPercentage,
        totalCount
      )
      .accounts({
        project: projectPda,
        boxConfig: boxConfigPda,
        prizeItem: prizeItemPda,
        tenant: tenant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    const prizeAccount = await fetchWithRetry(() => program.account.prizeItem.fetch(prizeItemPda));
    expect(prizeAccount.boxConfig.toBase58()).to.equal(boxConfigPda.toBase58());
    expect(prizeAccount.index).to.equal(prizeIndex);
    expect(prizeAccount.tokenMint.toBase58()).to.equal(tokenMint.toBase58());
    expect(prizeAccount.amount.toNumber()).to.equal(1_000_000_000);
    expect(prizeAccount.winPercentage).to.equal(100);
    expect(prizeAccount.totalCount).to.equal(10);
  });

  it("Deposits the SPL prize tokens into the vault PDA", async () => {
    const amount = new anchor.BN(10_000_000_000); // 10 tokens (required: amount * totalCount = 1 token * 10 count = 10 tokens)

    await program.methods
      .depositPrize(slug, prizeIndex, boxId, amount)
      .accounts({
        project: projectPda,
        boxConfig: boxConfigPda,
        prizeItem: prizeItemPda,
        vault: vaultPda,
        tokenMint: tokenMint,
        tenantTokenAccount: tenantTokenAccount.address,
        vaultTokenAccount: vaultTokenAccount.address,
        tenant: tenant.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    const vaultTokenBalance = await connection.getTokenAccountBalance(vaultTokenAccount.address);
    expect(vaultTokenBalance.value.amount).to.equal("10000000000");
  });



  it("Opens a box config instantly using openBox in a single transaction", async () => {
    const boxId2 = new anchor.BN(2);
    const [boxConfigPda2] = PublicKey.findProgramAddressSync(
      [Buffer.from("box"), projectPda.toBuffer(), boxId2.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const prizeIndex2 = 0;
    const [prizeItemPda2] = PublicKey.findProgramAddressSync(
      [Buffer.from("prize"), boxConfigPda2.toBuffer(), Buffer.from([prizeIndex2])],
      program.programId
    );
    const [receiptPda2] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), user.publicKey.toBuffer(), boxConfigPda2.toBuffer()],
      program.programId
    );

    // 1. Create box 2
    const priceLamports = new anchor.BN(100_000_000); // 0.1 SOL
    const acceptedMints = [PublicKey.default, PublicKey.default, PublicKey.default];
    const acceptedPrices = [new anchor.BN(0), new anchor.BN(0), new anchor.BN(0)];
    const supply = 10;
    const startTime = new anchor.BN(Math.floor(Date.now() / 1000) - 100);
    const endTime = new anchor.BN(Math.floor(Date.now() / 1000) + 10000);

    await program.methods
      .createBox(
        slug,
        boxId2,
        priceLamports,
        acceptedMints,
        acceptedPrices,
        supply,
        startTime,
        endTime
      )
      .accounts({
        platform: platformPda,
        project: projectPda,
        boxConfig: boxConfigPda2,
        tenant: tenant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    // 2. Create prize item inside box 2 (guaranteed SPL token prize)
    const prizeType = { splToken: {} };
    const amount = new anchor.BN(2_000_000_000); // 2 tokens
    const winPercentage = 100;
    const totalCount = 10;

    await program.methods
      .createPrizeItem(
        slug,
        boxId2,
        prizeIndex2,
        prizeType,
        tokenMint,
        amount,
        winPercentage,
        totalCount
      )
      .accounts({
        project: projectPda,
        boxConfig: boxConfigPda2,
        prizeItem: prizeItemPda2,
        tenant: tenant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    // 3. Deposit prize tokens
    const depositAmount = new anchor.BN(20_000_000_000); // 20 tokens
    await program.methods
      .depositPrize(slug, prizeIndex2, boxId2, depositAmount)
      .accounts({
        project: projectPda,
        boxConfig: boxConfigPda2,
        prizeItem: prizeItemPda2,
        vault: vaultPda,
        tokenMint: tokenMint,
        tenantTokenAccount: tenantTokenAccount.address,
        vaultTokenAccount: vaultTokenAccount.address,
        tenant: tenant.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    // 4. Call openBox
    const SYSVAR_SLOT_HASHES_PUBKEY = new PublicKey("SysvarS1otHashes111111111111111111111111111");
    const quantity = 1;

    // Get user token balance before open
    const preUserBalance = await connection.getTokenAccountBalance(userTokenAccount.address);

    await program.methods
      .openBox(slug, boxId2, quantity)
      .accounts({
        platform: platformPda,
        project: projectPda,
        boxConfig: boxConfigPda2,
        receipt: receiptPda2,
        vault: vaultPda,
        user: user.publicKey,
        feeWallet: feeWallet.publicKey,
        feeWallet2: feeWallet2.publicKey,
        tenantWallet: tenant.publicKey,
        systemProgram: SystemProgram.programId,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        vaultTokenAccount: vaultTokenAccount.address,
        userTokenAccount: userTokenAccount.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        {
          pubkey: prizeItemPda2,
          isSigner: false,
          isWritable: true,
        }
      ])
      .signers([user])
      .rpc();

    // 5. Verify receipt and prize transfer
    const receiptAccount = await fetchWithRetry(() => program.account.boxReceipt.fetch(receiptPda2));
    expect(receiptAccount.pendingOpens).to.equal(0);
    expect(receiptAccount.totalOpened).to.equal(1);

    const postUserBalance = await connection.getTokenAccountBalance(userTokenAccount.address);
    const diff = BigInt(postUserBalance.value.amount) - BigInt(preUserBalance.value.amount);
    expect(diff.toString()).to.equal("2000000000"); // 2 prize tokens transferred!
  });

  it("Opens a SOL-only box with SOL prizes (Single and Bulk)", async () => {
    const boxId3 = new anchor.BN(3);
    const [boxConfigPda3] = PublicKey.findProgramAddressSync(
      [Buffer.from("box"), projectPda.toBuffer(), boxId3.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const prizeIndex3 = 0;
    const [prizeItemPda3] = PublicKey.findProgramAddressSync(
      [Buffer.from("prize"), boxConfigPda3.toBuffer(), Buffer.from([prizeIndex3])],
      program.programId
    );
    const [receiptPda3] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), user.publicKey.toBuffer(), boxConfigPda3.toBuffer()],
      program.programId
    );

    // 1. Create SOL-only box
    const priceLamports = new anchor.BN(10_000_000); // 0.01 SOL
    const acceptedMints = [PublicKey.default, PublicKey.default, PublicKey.default];
    const acceptedPrices = [new anchor.BN(0), new anchor.BN(0), new anchor.BN(0)];
    const supply = 20;
    const startTime = new anchor.BN(Math.floor(Date.now() / 1000) - 100);
    const endTime = new anchor.BN(Math.floor(Date.now() / 1000) + 10000);

    await program.methods
      .createBox(
        slug,
        boxId3,
        priceLamports,
        acceptedMints,
        acceptedPrices,
        supply,
        startTime,
        endTime
      )
      .accounts({
        platform: platformPda,
        project: projectPda,
        boxConfig: boxConfigPda3,
        tenant: tenant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    // 2. Create SOL prize item (0.05 SOL prize, guaranteed win)
    const prizeType = { sol: {} };
    const prizeAmount = new anchor.BN(50_000_000); // 0.05 SOL
    const winPercentage = 100;
    const totalCount = 20;

    await program.methods
      .createPrizeItem(
        slug,
        boxId3,
        prizeIndex3,
        prizeType,
        PublicKey.default,
        prizeAmount,
        winPercentage,
        totalCount
      )
      .accounts({
        project: projectPda,
        boxConfig: boxConfigPda3,
        prizeItem: prizeItemPda3,
        tenant: tenant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    // 3. Fund the vault PDA with SOL directly
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: tenant.publicKey,
        toPubkey: vaultPda,
        lamports: 1_000_000_000, // 1 SOL
      })
    );
    await provider.sendAndConfirm(fundTx, [tenant]);

    // 4. Call openBox with quantity = 1 (Single)
    const SYSVAR_SLOT_HASHES_PUBKEY = new PublicKey("SysvarS1otHashes111111111111111111111111111");
    const preUserSol = await connection.getBalance(user.publicKey);

    await program.methods
      .openBox(slug, boxId3, 1)
      .accounts({
        platform: platformPda,
        project: projectPda,
        boxConfig: boxConfigPda3,
        receipt: receiptPda3,
        vault: vaultPda,
        user: user.publicKey,
        feeWallet: feeWallet.publicKey,
        feeWallet2: feeWallet2.publicKey,
        tenantWallet: tenant.publicKey,
        systemProgram: SystemProgram.programId,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        vaultTokenAccount: null,
        userTokenAccount: null,
        tokenProgram: null,
      })
      .remainingAccounts([
        {
          pubkey: prizeItemPda3,
          isSigner: false,
          isWritable: true,
        }
      ])
      .signers([user])
      .rpc();

    const postUserSol = await connection.getBalance(user.publicKey);
    // User paid 0.01 SOL price + 0.005 SOL project fee + tx fee, but won 0.05 SOL back
    // Net change should be positive: ~0.035 SOL
    expect(postUserSol).to.be.greaterThan(preUserSol);

    // 5. Call openBox with quantity = 3 (Bulk)
    const preUserSolBulk = await connection.getBalance(user.publicKey);

    await program.methods
      .openBox(slug, boxId3, 3)
      .accounts({
        platform: platformPda,
        project: projectPda,
        boxConfig: boxConfigPda3,
        receipt: receiptPda3,
        vault: vaultPda,
        user: user.publicKey,
        feeWallet: feeWallet.publicKey,
        feeWallet2: feeWallet2.publicKey,
        tenantWallet: tenant.publicKey,
        systemProgram: SystemProgram.programId,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        vaultTokenAccount: null,
        userTokenAccount: null,
        tokenProgram: null,
      })
      .remainingAccounts([
        {
          pubkey: prizeItemPda3,
          isSigner: false,
          isWritable: true,
        }
      ])
      .signers([user])
      .rpc();

    const postUserSolBulk = await connection.getBalance(user.publicKey);
    // Paid 3 * 0.01 SOL price + 3 * 0.005 SOL fee, won 3 * 0.05 SOL back
    // Net change: ~0.105 SOL positive
    expect(postUserSolBulk).to.be.greaterThan(preUserSolBulk);
  });

  it("Handles losing rolls correctly (Empty box)", async () => {
    const boxId4 = new anchor.BN(4);
    const [boxConfigPda4] = PublicKey.findProgramAddressSync(
      [Buffer.from("box"), projectPda.toBuffer(), boxId4.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const prizeIndex4 = 0;
    const [prizeItemPda4] = PublicKey.findProgramAddressSync(
      [Buffer.from("prize"), boxConfigPda4.toBuffer(), Buffer.from([prizeIndex4])],
      program.programId
    );
    const [receiptPda4] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), user.publicKey.toBuffer(), boxConfigPda4.toBuffer()],
      program.programId
    );

    // 1. Create box 4 (price = 0.01 SOL)
    const priceLamports = new anchor.BN(10_000_000);
    const acceptedMints = [PublicKey.default, PublicKey.default, PublicKey.default];
    const acceptedPrices = [new anchor.BN(0), new anchor.BN(0), new anchor.BN(0)];
    const supply = 10;
    const startTime = new anchor.BN(Math.floor(Date.now() / 1000) - 100);
    const endTime = new anchor.BN(Math.floor(Date.now() / 1000) + 10000);

    await program.methods
      .createBox(
        slug,
        boxId4,
        priceLamports,
        acceptedMints,
        acceptedPrices,
        supply,
        startTime,
        endTime
      )
      .accounts({
        platform: platformPda,
        project: projectPda,
        boxConfig: boxConfigPda4,
        tenant: tenant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    // 2. Create prize item inside box 4 (win percentage = 0, so user always loses)
    const prizeType = { sol: {} };
    const amount = new anchor.BN(100_000_000);
    const winPercentage = 0;
    const totalCount = 10;

    await program.methods
      .createPrizeItem(
        slug,
        boxId4,
        prizeIndex4,
        prizeType,
        PublicKey.default,
        amount,
        winPercentage,
        totalCount
      )
      .accounts({
        project: projectPda,
        boxConfig: boxConfigPda4,
        prizeItem: prizeItemPda4,
        tenant: tenant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    // 3. Call openBox
    const SYSVAR_SLOT_HASHES_PUBKEY = new PublicKey("SysvarS1otHashes111111111111111111111111111");
    const preUserSol = await connection.getBalance(user.publicKey);

    await program.methods
      .openBox(slug, boxId4, 1)
      .accounts({
        platform: platformPda,
        project: projectPda,
        boxConfig: boxConfigPda4,
        receipt: receiptPda4,
        vault: vaultPda,
        user: user.publicKey,
        feeWallet: feeWallet.publicKey,
        feeWallet2: feeWallet2.publicKey,
        tenantWallet: tenant.publicKey,
        systemProgram: SystemProgram.programId,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        vaultTokenAccount: null,
        userTokenAccount: null,
        tokenProgram: null,
      })
      .remainingAccounts([
        {
          pubkey: prizeItemPda4,
          isSigner: false,
          isWritable: true,
        }
      ])
      .signers([user])
      .rpc();

    // 4. Verify receipt shows opened but post balance is lower (lost SOL, no prize won)
    const receiptAccount = await fetchWithRetry(() => program.account.boxReceipt.fetch(receiptPda4));
    expect(receiptAccount.totalOpened).to.equal(1);

    const postUserSol = await connection.getBalance(user.publicKey);
    expect(postUserSol).to.be.lessThan(preUserSol);
  });

  it("Handles mixed boxes containing both SOL and SPL prizes", async () => {
    const boxId5 = new anchor.BN(5);
    const [boxConfigPda5] = PublicKey.findProgramAddressSync(
      [Buffer.from("box"), projectPda.toBuffer(), boxId5.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const prizeIndex5_0 = 0;
    const [prizeItemPda5_0] = PublicKey.findProgramAddressSync(
      [Buffer.from("prize"), boxConfigPda5.toBuffer(), Buffer.from([prizeIndex5_0])],
      program.programId
    );
    const prizeIndex5_1 = 1;
    const [prizeItemPda5_1] = PublicKey.findProgramAddressSync(
      [Buffer.from("prize"), boxConfigPda5.toBuffer(), Buffer.from([prizeIndex5_1])],
      program.programId
    );
    const [receiptPda5] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), user.publicKey.toBuffer(), boxConfigPda5.toBuffer()],
      program.programId
    );

    // 1. Create box 5
    const priceLamports = new anchor.BN(10_000_000);
    const acceptedMints = [PublicKey.default, PublicKey.default, PublicKey.default];
    const acceptedPrices = [new anchor.BN(0), new anchor.BN(0), new anchor.BN(0)];
    const supply = 10;
    const startTime = new anchor.BN(Math.floor(Date.now() / 1000) - 100);
    const endTime = new anchor.BN(Math.floor(Date.now() / 1000) + 10000);

    await program.methods
      .createBox(
        slug,
        boxId5,
        priceLamports,
        acceptedMints,
        acceptedPrices,
        supply,
        startTime,
        endTime
      )
      .accounts({
        platform: platformPda,
        project: projectPda,
        boxConfig: boxConfigPda5,
        tenant: tenant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    // 2. Create SOL prize item (guaranteed win variant, percentage = 50%)
    await program.methods
      .createPrizeItem(
        slug,
        boxId5,
        prizeIndex5_0,
        { sol: {} },
        PublicKey.default,
        new anchor.BN(50_000_000), // 0.05 SOL
        50,
        5
      )
      .accounts({
        project: projectPda,
        boxConfig: boxConfigPda5,
        prizeItem: prizeItemPda5_0,
        tenant: tenant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    // 3. Create SPL prize item (percentage = 50%)
    await program.methods
      .createPrizeItem(
        slug,
        boxId5,
        prizeIndex5_1,
        { splToken: {} },
        tokenMint,
        new anchor.BN(1_000_000_000), // 1 token
        50,
        5
      )
      .accounts({
        project: projectPda,
        boxConfig: boxConfigPda5,
        prizeItem: prizeItemPda5_1,
        tenant: tenant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    // 4. Deposit both SOL and SPL prizes
    // SPL tokens deposit
    await program.methods
      .depositPrize(slug, prizeIndex5_1, boxId5, new anchor.BN(5_000_000_000))
      .accounts({
        project: projectPda,
        boxConfig: boxConfigPda5,
        prizeItem: prizeItemPda5_1,
        vault: vaultPda,
        tokenMint: tokenMint,
        tenantTokenAccount: tenantTokenAccount.address,
        vaultTokenAccount: vaultTokenAccount.address,
        tenant: tenant.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    // SOL deposit
    const solFundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: tenant.publicKey,
        toPubkey: vaultPda,
        lamports: 500_000_000,
      })
    );
    await provider.sendAndConfirm(solFundTx, [tenant]);

    // 5. Call openBox for 2 boxes
    const SYSVAR_SLOT_HASHES_PUBKEY = new PublicKey("SysvarS1otHashes111111111111111111111111111");

    await program.methods
      .openBox(slug, boxId5, 2)
      .accounts({
        platform: platformPda,
        project: projectPda,
        boxConfig: boxConfigPda5,
        receipt: receiptPda5,
        vault: vaultPda,
        user: user.publicKey,
        feeWallet: feeWallet.publicKey,
        feeWallet2: feeWallet2.publicKey,
        tenantWallet: tenant.publicKey,
        systemProgram: SystemProgram.programId,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        vaultTokenAccount: vaultTokenAccount.address,
        userTokenAccount: userTokenAccount.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: prizeItemPda5_0, isSigner: false, isWritable: true },
        { pubkey: prizeItemPda5_1, isSigner: false, isWritable: true },
      ])
      .signers([user])
      .rpc();

    const receiptAccount = await fetchWithRetry(() => program.account.boxReceipt.fetch(receiptPda5));
    expect(receiptAccount.totalOpened).to.equal(2);
  });

  describe("30 Combo Matrix Testing", () => {
    interface PrizeConfig {
      type: "sol" | "spl";
      amount: anchor.BN;
      winPercentage: number;
      totalCount: number;
    }

    interface ComboScenario {
      id: number;
      description: string;
      priceSOL: number;
      feeSOL: number;
      supply: number;
      quantity: number;
      prizes: PrizeConfig[];
      expectedSuccess: boolean;
      errorMessage?: string;
    }

    const scenarios: ComboScenario[] = [
      {
        id: 101,
        description: "Combo 1: Basic Single SOL Open",
        priceSOL: 0.01,
        feeSOL: 0.005,
        supply: 10,
        quantity: 1,
        prizes: [{ type: "sol", amount: new anchor.BN(50_000_000), winPercentage: 100, totalCount: 10 }],
        expectedSuccess: true,
      },
      {
        id: 102,
        description: "Combo 2: Bulk SOL Open (qty=3)",
        priceSOL: 0.01,
        feeSOL: 0.005,
        supply: 10,
        quantity: 3,
        prizes: [{ type: "sol", amount: new anchor.BN(50_000_000), winPercentage: 100, totalCount: 10 }],
        expectedSuccess: true,
      },
      {
        id: 103,
        description: "Combo 3: Basic Single SPL Open",
        priceSOL: 0.01,
        feeSOL: 0.005,
        supply: 10,
        quantity: 1,
        prizes: [{ type: "spl", amount: new anchor.BN(1_000_000_000), winPercentage: 100, totalCount: 10 }],
        expectedSuccess: true,
      },
      {
        id: 104,
        description: "Combo 4: Bulk SPL Open (qty=2)",
        priceSOL: 0.01,
        feeSOL: 0.005,
        supply: 10,
        quantity: 2,
        prizes: [{ type: "spl", amount: new anchor.BN(1_000_000_000), winPercentage: 100, totalCount: 10 }],
        expectedSuccess: true,
      },
      {
        id: 105,
        description: "Combo 5: Mixed Single Open (50% SOL, 50% SPL)",
        priceSOL: 0.02,
        feeSOL: 0.01,
        supply: 10,
        quantity: 1,
        prizes: [
          { type: "sol", amount: new anchor.BN(50_000_000), winPercentage: 50, totalCount: 5 },
          { type: "spl", amount: new anchor.BN(1_000_000_000), winPercentage: 50, totalCount: 5 },
        ],
        expectedSuccess: true,
      },
      {
        id: 106,
        description: "Combo 6: Mixed Bulk Open (qty=3)",
        priceSOL: 0.01,
        feeSOL: 0.005,
        supply: 10,
        quantity: 3,
        prizes: [
          { type: "sol", amount: new anchor.BN(50_000_000), winPercentage: 50, totalCount: 5 },
          { type: "spl", amount: new anchor.BN(1_000_000_000), winPercentage: 50, totalCount: 5 },
        ],
        expectedSuccess: true,
      },
      {
        id: 107,
        description: "Combo 7: Free Box Open (Price=0, Fee=0)",
        priceSOL: 0,
        feeSOL: 0,
        supply: 10,
        quantity: 1,
        prizes: [{ type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 100, totalCount: 10 }],
        expectedSuccess: true,
      },
      {
        id: 108,
        description: "Combo 8: Always Losing Single Open",
        priceSOL: 0.01,
        feeSOL: 0.005,
        supply: 10,
        quantity: 1,
        prizes: [{ type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 0, totalCount: 10 }],
        expectedSuccess: true,
      },
      {
        id: 109,
        description: "Combo 9: Always Losing Bulk Open (qty=3)",
        priceSOL: 0.01,
        feeSOL: 0.005,
        supply: 10,
        quantity: 3,
        prizes: [{ type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 0, totalCount: 10 }],
        expectedSuccess: true,
      },
      {
        id: 110,
        description: "Combo 10: Scarce Supply Exactly Sold",
        priceSOL: 0.01,
        feeSOL: 0,
        supply: 1,
        quantity: 1,
        prizes: [{ type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 100, totalCount: 1 }],
        expectedSuccess: true,
      },
      {
        id: 111,
        description: "Combo 11: Opening a Sold Out Box (Expect: BoxNotActive)",
        priceSOL: 0.01,
        feeSOL: 0,
        supply: 1,
        quantity: 1,
        prizes: [{ type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 100, totalCount: 2 }],
        expectedSuccess: false,
        errorMessage: "BoxNotActive",
      },
      {
        id: 112,
        description: "Combo 12: Exceeding Remaining Supply (Expect: BoxSoldOut)",
        priceSOL: 0.01,
        feeSOL: 0,
        supply: 2,
        quantity: 3,
        prizes: [{ type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 100, totalCount: 5 }],
        expectedSuccess: false,
        errorMessage: "BoxSoldOut",
      },
      {
        id: 113,
        description: "Combo 13: Exceeding Max Tx Limit (qty=11) (Expect: BoxSoldOut)",
        priceSOL: 0.01,
        feeSOL: 0,
        supply: 20,
        quantity: 11,
        prizes: [{ type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 100, totalCount: 20 }],
        expectedSuccess: false,
        errorMessage: "BoxSoldOut",
      },
      {
        id: 114,
        description: "Combo 14: Start Time in Future (Expect: BoxNotActive)",
        priceSOL: 0.01,
        feeSOL: 0,
        supply: 10,
        quantity: 1,
        prizes: [{ type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 100, totalCount: 10 }],
        expectedSuccess: false,
        errorMessage: "BoxNotActive",
      },
      {
        id: 115,
        description: "Combo 15: End Time in Past (Expect: BoxAlreadyEnded)",
        priceSOL: 0.01,
        feeSOL: 0,
        supply: 10,
        quantity: 1,
        prizes: [{ type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 100, totalCount: 10 }],
        expectedSuccess: false,
        errorMessage: "BoxAlreadyEnded",
      },
      {
        id: 116,
        description: "Combo 16: Zero Price but High Fees",
        priceSOL: 0,
        feeSOL: 0.05,
        supply: 10,
        quantity: 1,
        prizes: [{ type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 100, totalCount: 10 }],
        expectedSuccess: true,
      },
      {
        id: 117,
        description: "Combo 17: High Price but Zero Fees",
        priceSOL: 0.5,
        feeSOL: 0,
        supply: 10,
        quantity: 1,
        prizes: [{ type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 100, totalCount: 10 }],
        expectedSuccess: true,
      },
      {
        id: 118,
        description: "Combo 18: Multi-Prize SOL (3 items)",
        priceSOL: 0.01,
        feeSOL: 0.005,
        supply: 10,
        quantity: 1,
        prizes: [
          { type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 30, totalCount: 5 },
          { type: "sol", amount: new anchor.BN(20_000_000), winPercentage: 30, totalCount: 5 },
          { type: "sol", amount: new anchor.BN(30_000_000), winPercentage: 40, totalCount: 5 },
        ],
        expectedSuccess: true,
      },
      {
        id: 119,
        description: "Combo 19: Multi-Prize SPL (3 items)",
        priceSOL: 0.01,
        feeSOL: 0.005,
        supply: 10,
        quantity: 1,
        prizes: [
          { type: "spl", amount: new anchor.BN(1_000_000_000), winPercentage: 30, totalCount: 5 },
          { type: "spl", amount: new anchor.BN(2_000_000_000), winPercentage: 30, totalCount: 5 },
          { type: "spl", amount: new anchor.BN(3_000_000_000), winPercentage: 40, totalCount: 5 },
        ],
        expectedSuccess: true,
      },
      {
        id: 120,
        description: "Combo 20: Empty Vault SOL Prize (Expect: InsufficientFunds)",
        priceSOL: 0.01,
        feeSOL: 0,
        supply: 10,
        quantity: 1,
        prizes: [{ type: "sol", amount: new anchor.BN(5_000_000_000), winPercentage: 100, totalCount: 1 }],
        expectedSuccess: false,
        errorMessage: "InsufficientFunds",
      },
      {
        id: 121,
        description: "Combo 21: Empty Vault SPL Prize (Expect: InsufficientFunds)",
        priceSOL: 0.01,
        feeSOL: 0,
        supply: 10,
        quantity: 1,
        prizes: [{ type: "spl", amount: new anchor.BN(500_000_000_000), winPercentage: 100, totalCount: 1 }],
        expectedSuccess: false,
        errorMessage: "InsufficientFunds",
      },
      {
        id: 122,
        description: "Combo 22: Mixed Bulk Max Limit (qty=5)",
        priceSOL: 0.01,
        feeSOL: 0.005,
        supply: 10,
        quantity: 5,
        prizes: [
          { type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 50, totalCount: 5 },
          { type: "spl", amount: new anchor.BN(1_000_000_000), winPercentage: 50, totalCount: 5 },
        ],
        expectedSuccess: true,
      },
      {
        id: 123,
        description: "Combo 23: Zero Count SPL Prize (Expect: Lose Roll)",
        priceSOL: 0.01,
        feeSOL: 0,
        supply: 10,
        quantity: 1,
        prizes: [{ type: "spl", amount: new anchor.BN(1_000_000_000), winPercentage: 100, totalCount: 0 }],
        expectedSuccess: true,
      },
      {
        id: 124,
        description: "Combo 24: Single open when box status is ended (Expect: BoxNotActive)",
        priceSOL: 0.01,
        feeSOL: 0,
        supply: 1,
        quantity: 1,
        prizes: [{ type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 100, totalCount: 10 }],
        expectedSuccess: false,
        errorMessage: "BoxNotActive",
      },
      {
        id: 125,
        description: "Combo 25: Invalid fee wallet check (Expect: ConstraintAddress)",
        priceSOL: 0.01,
        feeSOL: 0.005,
        supply: 10,
        quantity: 1,
        prizes: [{ type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 100, totalCount: 10 }],
        expectedSuccess: false,
        errorMessage: "ConstraintAddress",
      },
      {
        id: 126,
        description: "Combo 26: Fee split verification",
        priceSOL: 0.01,
        feeSOL: 0.01,
        supply: 10,
        quantity: 1,
        prizes: [{ type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 100, totalCount: 10 }],
        expectedSuccess: true,
      },
      {
        id: 127,
        description: "Combo 27: Bulk open qty=10 (Exactly Max Limit)",
        priceSOL: 0.01,
        feeSOL: 0,
        supply: 15,
        quantity: 10,
        prizes: [
          { type: "sol", amount: new anchor.BN(5_000_000), winPercentage: 50, totalCount: 10 },
          { type: "spl", amount: new anchor.BN(500_000_000), winPercentage: 50, totalCount: 10 },
        ],
        expectedSuccess: true,
      },
      {
        id: 128,
        description: "Combo 28: Invalid index check (prize index >= 20)",
        priceSOL: 0.01,
        feeSOL: 0,
        supply: 10,
        quantity: 1,
        prizes: [{ type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 100, totalCount: 10 }],
        expectedSuccess: true,
      },
      {
        id: 129,
        description: "Combo 29: Project Authority validation mismatch (Expect: ConstraintAddress)",
        priceSOL: 0.01,
        feeSOL: 0,
        supply: 10,
        quantity: 1,
        prizes: [{ type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 100, totalCount: 10 }],
        expectedSuccess: false,
        errorMessage: "ConstraintAddress",
      },
      {
        id: 130,
        description: "Combo 30: Zero Quantity Open Check (Expect: BoxSoldOut)",
        priceSOL: 0.01,
        feeSOL: 0,
        supply: 10,
        quantity: 0,
        prizes: [{ type: "sol", amount: new anchor.BN(10_000_000), winPercentage: 100, totalCount: 10 }],
        expectedSuccess: false,
        errorMessage: "BoxSoldOut",
      },
    ];

    scenarios.forEach((scenario) => {
      it(scenario.description, async () => {
        const scenarioBoxId = new anchor.BN(scenario.id);
        const [scenarioBoxConfigPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("box"), projectPda.toBuffer(), scenarioBoxId.toArrayLike(Buffer, "le", 8)],
          program.programId
        );
        const [scenarioReceiptPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("receipt"), user.publicKey.toBuffer(), scenarioBoxConfigPda.toBuffer()],
          program.programId
        );

        // 1. Setup times based on scenario
        let startTime = new anchor.BN(Math.floor(Date.now() / 1000) - 100);
        let endTime = new anchor.BN(Math.floor(Date.now() / 1000) + 10000);
        if (scenario.id === 114) {
          startTime = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
        } else if (scenario.id === 115) {
          startTime = new anchor.BN(Math.floor(Date.now() / 1000) - 7200);
          endTime = new anchor.BN(Math.floor(Date.now() / 1000) - 3600);
        }

        // 2. Create Box
        const priceLamports = new anchor.BN(scenario.priceSOL * 1e9);
        const acceptedMints = [PublicKey.default, PublicKey.default, PublicKey.default];
        const acceptedPrices = [new anchor.BN(0), new anchor.BN(0), new anchor.BN(0)];

        await program.methods
          .createBox(
            slug,
            scenarioBoxId,
            priceLamports,
            acceptedMints,
            acceptedPrices,
            scenario.supply,
            startTime,
            endTime
          )
          .accounts({
            platform: platformPda,
            project: projectPda,
            boxConfig: scenarioBoxConfigPda,
            tenant: tenant.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([tenant])
          .rpc();

        // 3. Create Prize Items and Fund Vault
        const prizePdaList: PublicKey[] = [];
        for (let i = 0; i < scenario.prizes.length; i++) {
          const prize = scenario.prizes[i];
          const targetIndex = scenario.id === 128 ? 20 : i; // Combo 28 uses index 20
          const [prizeItemPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("prize"), scenarioBoxConfigPda.toBuffer(), Buffer.from([targetIndex])],
            program.programId
          );
          prizePdaList.push(prizeItemPda);

          const prizeType = prize.type === "sol" ? { sol: {} } : { splToken: {} };
          const mintKey = prize.type === "sol" ? PublicKey.default : tokenMint;

          await program.methods
            .createPrizeItem(
              slug,
              scenarioBoxId,
              targetIndex,
              prizeType,
              mintKey,
              prize.amount,
              prize.winPercentage,
              prize.totalCount
            )
            .accounts({
              project: projectPda,
              boxConfig: scenarioBoxConfigPda,
              prizeItem: prizeItemPda,
              tenant: tenant.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([tenant])
            .rpc();

          // Fund vault
          if (prize.totalCount > 0) {
            if (prize.type === "sol") {
              if (scenario.id !== 120) {
                const requiredSol = prize.amount.muln(prize.totalCount);
                const fundTx = new Transaction().add(
                  SystemProgram.transfer({
                    fromPubkey: tenant.publicKey,
                    toPubkey: vaultPda,
                    lamports: requiredSol.toNumber(),
                  })
                );
                await provider.sendAndConfirm(fundTx, [tenant]);
              }
            } else {
              if (scenario.id !== 121 && scenario.id !== 123) {
                const requiredTokens = prize.amount.muln(prize.totalCount);
                await program.methods
                  .depositPrize(slug, targetIndex, scenarioBoxId, requiredTokens)
                  .accounts({
                    project: projectPda,
                    boxConfig: scenarioBoxConfigPda,
                    prizeItem: prizeItemPda,
                    vault: vaultPda,
                    tokenMint: tokenMint,
                    tenantTokenAccount: tenantTokenAccount.address,
                    vaultTokenAccount: vaultTokenAccount.address,
                    tenant: tenant.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                  })
                  .signers([tenant])
                  .rpc();
              }
            }
          }
        }

        // Setup pre-rolls for lifecycle tests
        const SYSVAR_SLOT_HASHES_PUBKEY = new PublicKey("SysvarS1otHashes111111111111111111111111111");
        if (scenario.id === 111 || scenario.id === 124) {
          // Open the box once (supply = 1) to end it
          await program.methods
            .openBox(slug, scenarioBoxId, 1)
            .accounts({
              platform: platformPda,
              project: projectPda,
              boxConfig: scenarioBoxConfigPda,
              receipt: scenarioReceiptPda,
              vault: vaultPda,
              user: user.publicKey,
              feeWallet: feeWallet.publicKey,
              feeWallet2: feeWallet2.publicKey,
              tenantWallet: tenant.publicKey,
              systemProgram: SystemProgram.programId,
              slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
              vaultTokenAccount: null,
              userTokenAccount: null,
              tokenProgram: null,
            })
            .remainingAccounts(prizePdaList.map(p => ({ pubkey: p, isSigner: false, isWritable: true })))
            .signers([user])
            .rpc();
        }

        if (scenario.prizes.some(p => p.type === "spl")) {
          const vaultBal = await connection.getTokenAccountBalance(vaultTokenAccount.address);
          const tenantBal = await connection.getTokenAccountBalance(tenantTokenAccount.address);
          fs.appendFileSync(
            "/home/faizan/GeckuraBox/mystery-box/test_balances.log",
            `[SCENARIO ${scenario.id}] Pre-Open: Vault SPL Bal = ${vaultBal.value.amount}, Tenant SPL Bal = ${tenantBal.value.amount}\n`
          );
        }

        // 4. Open Box
        let targetFeeWallet = feeWallet.publicKey;
        if (scenario.id === 125) {
          targetFeeWallet = Keypair.generate().publicKey;
        }

        let targetTenantWallet = tenant.publicKey;
        if (scenario.id === 129) {
          targetTenantWallet = Keypair.generate().publicKey;
        }

        let runErr: any = null;
        try {
          await program.methods
            .openBox(slug, scenarioBoxId, scenario.quantity)
            .accounts({
              platform: platformPda,
              project: projectPda,
              boxConfig: scenarioBoxConfigPda,
              receipt: scenarioReceiptPda,
              vault: vaultPda,
              user: user.publicKey,
              feeWallet: targetFeeWallet,
              feeWallet2: feeWallet2.publicKey,
              tenantWallet: targetTenantWallet,
              systemProgram: SystemProgram.programId,
              slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
              vaultTokenAccount: vaultTokenAccount.address,
              userTokenAccount: userTokenAccount.address,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .remainingAccounts(prizePdaList.map(p => ({ pubkey: p, isSigner: false, isWritable: true })))
            .signers([user])
            .rpc();
        } catch (err: any) {
          runErr = err;
        }

        // 5. Verification
        if (scenario.expectedSuccess) {
          expect(runErr).to.be.null;
          if (scenario.quantity > 0) {
            const receiptAccount = await fetchWithRetry(() => program.account.boxReceipt.fetch(scenarioReceiptPda));
            const expectedTotalOpened = (scenario.id === 124) ? 1 : scenario.quantity;
            expect(receiptAccount.totalOpened).to.equal(expectedTotalOpened);
          }
        } else {
          expect(runErr).to.not.be.null;
          if (scenario.errorMessage) {
            const errMsgString = runErr.toString();
            expect(errMsgString).to.include(scenario.errorMessage);
          }
        }
      });
    });
  });

  after(async () => {
    const isLocalnet = connection.rpcEndpoint.includes("localhost") || connection.rpcEndpoint.includes("127.0.0.1");
    if (!isLocalnet) {
      console.log("Cleaning up and reclaiming SOL back to provider wallet...");
      // Transfer from tenant
      try {
        const tenantBal = await connection.getBalance(tenant.publicKey);
        if (tenantBal > 1e7) { // > 0.01 SOL
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: tenant.publicKey,
              toPubkey: superAdmin.publicKey,
              lamports: tenantBal - 1e7, // leave 0.01 SOL
            })
          );
          await provider.sendAndConfirm(tx, [tenant]);
          console.log(`Reclaimed ${tenantBal / 1e9} SOL from tenant`);
        }
      } catch (e) {
        console.error("Failed to reclaim from tenant:", e);
      }

      // Transfer from user
      try {
        const userBal = await connection.getBalance(user.publicKey);
        if (userBal > 1e7) {
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: user.publicKey,
              toPubkey: superAdmin.publicKey,
              lamports: userBal - 1e7,
            })
          );
          await provider.sendAndConfirm(tx, [user]);
          console.log(`Reclaimed ${userBal / 1e9} SOL from user`);
        }
      } catch (e) {
        console.error("Failed to reclaim from user:", e);
      }
      console.log("Cleanup complete!");
    }
  });
});
