use anchor_lang::prelude::*;

use crate::errors::MysteryBoxError;
use crate::state::{PlatformConfig, Project, PROJECT_SEED, PLATFORM_SEED};

#[derive(Accounts)]
#[instruction(treasury: Pubkey)]
pub struct InitializePlatform<'info> {
    #[account(
        init,
        payer = super_admin,
        space = PlatformConfig::SPACE,
        seeds = [PLATFORM_SEED],
        bump
    )]
    pub platform: Account<'info, PlatformConfig>,
    #[account(mut)]
    pub super_admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(project_id: u64)]
pub struct CreateProject<'info> {
    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump
    )]
    pub platform: Account<'info, PlatformConfig>,
    #[account(
        init,
        payer = super_admin,
        space = Project::SPACE,
        seeds = [PROJECT_SEED, &project_id.to_le_bytes()],
        bump
    )]
    pub project: Account<'info, Project>,
    #[account(mut)]
    pub super_admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(project_id: u64)]
pub struct UpdateProjectFees<'info> {
    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump
    )]
    pub platform: Account<'info, PlatformConfig>,
    #[account(
        mut,
        seeds = [PROJECT_SEED, &project_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project>,
    pub super_admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(project_id: u64)]
pub struct CloseProject<'info> {
    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump
    )]
    pub platform: Account<'info, PlatformConfig>,
    #[account(
        mut,
        seeds = [PROJECT_SEED, &project_id.to_le_bytes()],
        bump = project.bump,
        close = super_admin
    )]
    pub project: Account<'info, Project>,
    pub super_admin: Signer<'info>,
}

pub fn initialize_platform(ctx: Context<InitializePlatform>, treasury: Pubkey) -> Result<()> {
    let expected_admin = Pubkey::new_from_array([
        210, 172, 147, 168, 119, 174, 233, 213, 111, 85, 134, 60, 125, 169, 167, 199, 89, 23, 27, 90, 222, 177, 107, 214, 165, 79, 126, 86, 30, 255, 32, 6
    ]);
    require_keys_eq!(
        ctx.accounts.super_admin.key(),
        expected_admin,
        MysteryBoxError::Unauthorized
    );
    let platform = &mut ctx.accounts.platform;
    platform.authority = ctx.accounts.super_admin.key();
    platform.treasury = treasury;
    platform.is_paused = false;
    platform.bump = ctx.bumps.platform;
    Ok(())
}

pub fn create_project(
    ctx: Context<CreateProject>,
    project_id: u64,
    authority: Pubkey,
    fee_wallet: Pubkey,
    fee_wallet_2: Pubkey,
    fee_lamports: u64,
    rent_claim_mode: u8,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.super_admin.key(),
        ctx.accounts.platform.authority,
        MysteryBoxError::Unauthorized
    );
    require!(
        !ctx.accounts.platform.is_paused,
        MysteryBoxError::PlatformPaused
    );

    let project = &mut ctx.accounts.project;
    project.project_id = project_id;
    project.authority = authority;
    project.fee_wallet = fee_wallet;
    project.fee_wallet_2 = fee_wallet_2;
    project.fee_lamports = fee_lamports;
    project.is_active = true;
    project.bump = ctx.bumps.project;
    project.rent_claim_mode = rent_claim_mode;
    project.active_boxes_count = 0;
    project.reserved = [0; 27];

    Ok(())
}

pub fn update_project_fees(
    ctx: Context<UpdateProjectFees>,
    _project_id: u64,
    new_fee_lamports: u64,
    new_fee_wallet: Pubkey,
    new_fee_wallet_2: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.super_admin.key(),
        ctx.accounts.platform.authority,
        MysteryBoxError::Unauthorized
    );

    let project = &mut ctx.accounts.project;
    project.fee_lamports = new_fee_lamports;
    project.fee_wallet = new_fee_wallet;
    project.fee_wallet_2 = new_fee_wallet_2;

    Ok(())
}

pub fn close_project(ctx: Context<CloseProject>, _project_id: u64) -> Result<()> {
     require_keys_eq!(
         ctx.accounts.super_admin.key(),
         ctx.accounts.platform.authority,
         MysteryBoxError::Unauthorized
     );
     require!(
         ctx.accounts.project.active_boxes_count == 0,
         MysteryBoxError::ProjectHasActiveBoxes
     );
     Ok(())
 }
