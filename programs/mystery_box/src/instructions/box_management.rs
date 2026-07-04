use anchor_lang::prelude::*;

use crate::errors::MysteryBoxError;
use crate::state::{
    BoxConfig, BoxStatus, PlatformConfig, Project, BOX_SEED, PLATFORM_SEED, PROJECT_SEED,
};

#[derive(Accounts)]
#[instruction(slug: String, box_id: u64)]
pub struct CreateBox<'info> {
    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump
    )]
    pub platform: Account<'info, PlatformConfig>,
    #[account(
        mut,
        seeds = [PROJECT_SEED, slug.as_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project>,
    #[account(
        init,
        payer = tenant,
        space = BoxConfig::SPACE,
        seeds = [BOX_SEED, project.key().as_ref(), &box_id.to_le_bytes()],
        bump
    )]
    pub box_config: Account<'info, BoxConfig>,
    #[account(mut)]
    pub tenant: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(slug: String, box_id: u64)]
pub struct UpdateBox<'info> {
    #[account(
        seeds = [PROJECT_SEED, slug.as_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project>,
    #[account(
        mut,
        seeds = [BOX_SEED, project.key().as_ref(), &box_id.to_le_bytes()],
        bump = box_config.bump
    )]
    pub box_config: Account<'info, BoxConfig>,
    pub tenant: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(slug: String, box_id: u64)]
pub struct CloseBox<'info> {
    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump
    )]
    pub platform: Account<'info, PlatformConfig>,
    #[account(
        mut,
        seeds = [PROJECT_SEED, slug.as_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project>,
    #[account(
        mut,
        seeds = [BOX_SEED, project.key().as_ref(), &box_id.to_le_bytes()],
        bump = box_config.bump,
        close = rent_destination
    )]
    pub box_config: Account<'info, BoxConfig>,
    pub signer: Signer<'info>,
    #[account(mut)]
    pub rent_destination: SystemAccount<'info>,
}

pub fn create_box(
    ctx: Context<CreateBox>,
    _slug: String,
    _box_id: u64,
    price_lamports: u64,
    accepted_mints: [Pubkey; 3],
    accepted_prices: [u64; 3],
    supply: u32,
    start_time: i64,
    end_time: i64,
) -> Result<()> {
    let project = &mut ctx.accounts.project;
    let platform = &ctx.accounts.platform;

    // Authorization: only project authority can create boxes
    require_keys_eq!(
        ctx.accounts.tenant.key(),
        project.authority,
        MysteryBoxError::Unauthorized
    );

    require!(project.is_active, MysteryBoxError::ProjectInactive);
    require!(!platform.is_paused, MysteryBoxError::PlatformPaused);
    require!(supply > 0, MysteryBoxError::BoxSoldOut);
    require!(end_time > start_time, MysteryBoxError::BoxAlreadyEnded);

    project.active_boxes_count = project.active_boxes_count
        .checked_add(1)
        .ok_or(MysteryBoxError::MathOverflow)?;

    let box_config = &mut ctx.accounts.box_config;
    box_config.project = project.key();
    box_config.box_id = _box_id;
    box_config.price_lamports = price_lamports;
    box_config.accepted_mints = accepted_mints;
    box_config.accepted_prices = accepted_prices;
    box_config.supply = supply;
    box_config.sold = 0;
    box_config.total_opened = 0;
    box_config.total_claimed = 0;
    box_config.claimed_prizes = [0; 20];
    box_config.start_time = start_time;
    box_config.end_time = end_time;
    box_config.status = BoxStatus::Active;
    box_config.bump = ctx.bumps.box_config;
    box_config.prizes_count = 0;

    Ok(())
}

pub fn update_box(
    ctx: Context<UpdateBox>,
    _slug: String,
    _box_id: u64,
    price_lamports: u64,
    accepted_mints: [Pubkey; 3],
    accepted_prices: [u64; 3],
    start_time: i64,
    end_time: i64,
) -> Result<()> {
    let project = &ctx.accounts.project;
    let box_config = &mut ctx.accounts.box_config;

    // Authorization: only project authority can update boxes
    require_keys_eq!(
        ctx.accounts.tenant.key(),
        project.authority,
        MysteryBoxError::Unauthorized
    );

    // Prevent re-activating ended boxes
    require!(
        box_config.status != BoxStatus::Ended,
        MysteryBoxError::BoxAlreadyEnded
    );

    box_config.price_lamports = price_lamports;
    box_config.accepted_mints = accepted_mints;
    box_config.accepted_prices = accepted_prices;
    box_config.start_time = start_time;
    box_config.end_time = end_time;
    box_config.status = BoxStatus::Active;

    Ok(())
}

pub fn close_box(ctx: Context<CloseBox>, _slug: String, _box_id: u64) -> Result<()> {
    let box_config = &ctx.accounts.box_config;
    let project = &mut ctx.accounts.project;
    let platform = &ctx.accounts.platform;

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let signer_key = ctx.accounts.signer.key();
    crate::state::validate_close_authority(
        signer_key,
        project.authority,
        platform.authority,
        project.rent_claim_mode,
        platform.treasury,
        ctx.accounts.rent_destination.key(),
    )?;

    require!(
        box_config.status == BoxStatus::Ended || now > box_config.end_time,
        MysteryBoxError::BoxNotEnded
    );
    require!(
        box_config.sold == box_config.total_opened,
        MysteryBoxError::BoxHasPendingReceipts
    );

    project.active_boxes_count = project.active_boxes_count
        .checked_sub(1)
        .ok_or(MysteryBoxError::MathOverflow)?;

    Ok(())
}
