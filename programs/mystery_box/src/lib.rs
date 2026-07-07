#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::box_management::*;
use instructions::platform::*;
use instructions::prize::*;
use instructions::user::*;

declare_id!("AEQrvbZvGwGcat5FXDXXZD71NiQsWNfdxvDFvdigxL5t");

#[program]
pub mod mystery_box {
    use super::*;

    pub fn initialize_platform(ctx: Context<InitializePlatform>, treasury: Pubkey) -> Result<()> {
        instructions::platform::initialize_platform(ctx, treasury)
    }

    pub fn create_project(
        ctx: Context<CreateProject>,
        slug: String,
        authority: Pubkey,
        fee_wallet: Pubkey,
        fee_wallet_2: Pubkey,
        fee_lamports: u64,
        rent_claim_mode: u8,
    ) -> Result<()> {
        instructions::platform::create_project(
            ctx, slug, authority, fee_wallet, fee_wallet_2, fee_lamports, rent_claim_mode,
        )
    }

    pub fn update_project_fees(
        ctx: Context<UpdateProjectFees>,
        slug: String,
        new_fee_lamports: u64,
        new_fee_wallet: Pubkey,
        new_fee_wallet_2: Pubkey,
    ) -> Result<()> {
        instructions::platform::update_project_fees(ctx, slug, new_fee_lamports, new_fee_wallet, new_fee_wallet_2)
    }

    pub fn close_project(ctx: Context<CloseProject>, slug: String) -> Result<()> {
        instructions::platform::close_project(ctx, slug)
    }

    pub fn create_box(
        ctx: Context<CreateBox>,
        slug: String,
        box_id: u64,
        price_lamports: u64,
        accepted_mints: [Pubkey; 3],
        accepted_prices: [u64; 3],
        supply: u32,
        start_time: i64,
        end_time: i64,
    ) -> Result<()> {
        instructions::box_management::create_box(
            ctx, slug, box_id, price_lamports, accepted_mints,
            accepted_prices, supply, start_time, end_time,
        )
    }

    pub fn update_box(
        ctx: Context<UpdateBox>,
        slug: String,
        box_id: u64,
        price_lamports: u64,
        accepted_mints: [Pubkey; 3],
        accepted_prices: [u64; 3],
        start_time: i64,
        end_time: i64,
    ) -> Result<()> {
        instructions::box_management::update_box(
            ctx, slug, box_id, price_lamports, accepted_mints,
            accepted_prices, start_time, end_time,
        )
    }

    pub fn close_box(ctx: Context<CloseBox>, slug: String, box_id: u64) -> Result<()> {
        instructions::box_management::close_box(ctx, slug, box_id)
    }



    pub fn initialize_vault(ctx: Context<InitializeVault>, slug: String) -> Result<()> {
        instructions::prize::initialize_vault(ctx, slug)
    }

    pub fn create_prize_item(
        ctx: Context<CreatePrizeItem>,
        slug: String,
        box_id: u64,
        prize_index: u8,
        prize_type: crate::state::PrizeType,
        token_mint: Pubkey,
        amount: u64,
        win_percentage: u8,
        total_count: u32,
    ) -> Result<()> {
        instructions::prize::create_prize_item(
            ctx, slug, box_id, prize_index, prize_type, token_mint, amount, win_percentage,
            total_count,
        )
    }

    pub fn manage_prize(
        ctx: Context<ManagePrize>,
        slug: String,
        prize_index: u8,
        box_id: u64,
        action: crate::state::ManagePrizeAction,
        amount: u64,
    ) -> Result<()> {
        instructions::prize::manage_prize(ctx, slug, prize_index, box_id, action, amount)
    }

    pub fn withdraw_vault_sol(
        ctx: Context<WithdrawVaultSol>,
        slug: String,
        amount: u64,
    ) -> Result<()> {
        instructions::prize::withdraw_vault_sol(ctx, slug, amount)
    }

    pub fn withdraw_vault_token(
        ctx: Context<WithdrawVaultToken>,
        slug: String,
        amount: u64,
    ) -> Result<()> {
        instructions::prize::withdraw_vault_token(ctx, slug, amount)
    }

    pub fn close_vault_token_account(
        ctx: Context<CloseVaultTokenAccount>,
        slug: String,
    ) -> Result<()> {
        instructions::prize::close_vault_token_account(ctx, slug)
    }

    pub fn open_box<'info>(
        ctx: Context<'info, OpenBox<'info>>,
        slug: String,
        box_id: u64,
        quantity: u8,
    ) -> Result<()> {
        instructions::user::open_box(ctx, slug, box_id, quantity)
    }

    pub fn claim_prizes<'info>(
        ctx: Context<'info, ClaimPrizes<'info>>,
        slug: String,
    ) -> Result<()> {
        instructions::user::claim_prizes(ctx, slug)
    }

    pub fn close_receipt(ctx: Context<CloseReceipt>, slug: String) -> Result<()> {
        instructions::user::close_receipt(ctx, slug)
    }
}
