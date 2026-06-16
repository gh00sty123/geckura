#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::box_management::*;
use instructions::platform::*;
use instructions::prize::*;
use instructions::user::*;

declare_id!("DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4");

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
        fee_lamports: u64,
        rent_claim_mode: u8,
    ) -> Result<()> {
        instructions::platform::create_project(
            ctx, slug, authority, fee_wallet, fee_lamports, rent_claim_mode,
        )
    }

    pub fn update_project_fees(
        ctx: Context<UpdateProjectFees>,
        slug: String,
        new_fee_lamports: u64,
        new_fee_wallet: Pubkey,
    ) -> Result<()> {
        instructions::platform::update_project_fees(ctx, slug, new_fee_lamports, new_fee_wallet)
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
    pub fn close_prize_item(
        ctx: Context<ClosePrizeItem>,
        slug: String,
        box_id: u64,
        prize_index: u8,
    ) -> Result<()> {
        instructions::prize::close_prize_item(ctx, slug, box_id, prize_index)
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

    pub fn deposit_prize(
        ctx: Context<DepositPrize>,
        slug: String,
        prize_index: u8,
        box_id: u64,
        amount: u64,
    ) -> Result<()> {
        instructions::prize::deposit_prize(ctx, slug, prize_index, box_id, amount)
    }

    pub fn withdraw_prize(
        ctx: Context<WithdrawPrize>,
        slug: String,
        box_id: u64,
        prize_index: u8,
    ) -> Result<()> {
        instructions::prize::withdraw_prize(ctx, slug, box_id, prize_index)
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

    pub fn buy_box(
        ctx: Context<BuyBox>,
        slug: String,
        box_id: u64,
        quantity: u8,
    ) -> Result<()> {
        instructions::user::buy_box(ctx, slug, box_id, quantity)
    }

    pub fn request_open(
        ctx: Context<RequestOpen>,
        slug: String,
        box_id: u64,
        quantity: u32,
    ) -> Result<()> {
        instructions::user::request_open(ctx, slug, box_id, quantity)
    }

    pub fn reveal_open(
        ctx: Context<RevealOpen>,
        slug: String,
        box_id: u64,
    ) -> Result<()> {
        instructions::user::reveal_open(ctx, slug, box_id)
    }


}

