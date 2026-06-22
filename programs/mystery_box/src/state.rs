use anchor_lang::prelude::*;

pub const DISCRIMINATOR_SIZE: usize = 8;
pub const PUBKEY_SIZE: usize = 32;
pub const BOOL_SIZE: usize = 1;
pub const U8_SIZE: usize = 1;
pub const U32_SIZE: usize = 4;
pub const U64_SIZE: usize = 8;
pub const I64_SIZE: usize = 8;
pub const STRING_PREFIX_SIZE: usize = 4;

pub const SLUG_MAX_LEN: usize = 30;
pub const PROJECT_NAME_MAX_LEN: usize = 50;
pub const PROJECT_DESCRIPTION_MAX_LEN: usize = 200;
pub const PROJECT_LOGO_URI_MAX_LEN: usize = 200;
pub const PROJECT_BG_URI_MAX_LEN: usize = 200;
pub const PROJECT_THEME_COLOR_MAX_LEN: usize = 10;

pub const BOX_NAME_MAX_LEN: usize = 50;
pub const BOX_DESCRIPTION_MAX_LEN: usize = 200;
pub const BOX_BANNER_URI_MAX_LEN: usize = 200;
pub const MAX_ACCEPTED_TOKENS: usize = 3;
pub const MAX_BOXES_PER_TX: u8 = 10;

pub const PLATFORM_SEED: &[u8] = b"platform";
pub const PROJECT_SEED: &[u8] = b"project";
pub const BOX_SEED: &[u8] = b"box";
pub const VAULT_SEED: &[u8] = b"vault";
pub const PRIZE_SEED: &[u8] = b"prize";
pub const RECEIPT_SEED: &[u8] = b"receipt";

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq)]
pub enum PrizeType {
    Sol,
    SplToken,
    Nft,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq)]
pub enum BoxStatus {
    Active,
    Paused,
    Ended,
}

#[account]
pub struct PlatformConfig {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub is_paused: bool,
    pub bump: u8,
}

impl PlatformConfig {
    pub const INIT_SPACE: usize = PUBKEY_SIZE + PUBKEY_SIZE + BOOL_SIZE + U8_SIZE;
    pub const SPACE: usize = DISCRIMINATOR_SIZE + Self::INIT_SPACE;
}

#[account]
pub struct Project {
    pub slug: String,
    pub authority: Pubkey,
    pub fee_wallet: Pubkey,
    pub fee_lamports: u64,
    pub is_active: bool,
    pub bump: u8,
    // 0 = project authority claims ATA rent, 1 = platform treasury claims ATA rent
    pub rent_claim_mode: u8,
    pub fee_wallet_2: Pubkey,
    // Reserved padding for future schema fields
    pub reserved: [u8; 31],
}

impl Project {
    pub const INIT_SPACE: usize = STRING_PREFIX_SIZE
        + SLUG_MAX_LEN
        + PUBKEY_SIZE
        + PUBKEY_SIZE
        + U64_SIZE
        + BOOL_SIZE
        + U8_SIZE
        + U8_SIZE // rent_claim_mode
        + PUBKEY_SIZE
        + 31; // reserved padding
    pub const SPACE: usize = DISCRIMINATOR_SIZE + Self::INIT_SPACE;
}


#[account]
pub struct BoxConfig {
    pub project: Pubkey,
    pub box_id: u64,
    pub price_lamports: u64,
    pub accepted_mints: [Pubkey; MAX_ACCEPTED_TOKENS],
    pub accepted_prices: [u64; MAX_ACCEPTED_TOKENS],
    pub supply: u32,
    pub sold: u32,
    pub total_opened: u32,
    pub total_claimed: u32,
    pub claimed_prizes: [u32; 20],
    pub start_time: i64,
    pub end_time: i64,
    pub status: BoxStatus,
    pub bump: u8,
}

impl BoxConfig {
    pub const INIT_SPACE: usize = PUBKEY_SIZE
        + U64_SIZE
        + U64_SIZE
        + (PUBKEY_SIZE * MAX_ACCEPTED_TOKENS)
        + (U64_SIZE * MAX_ACCEPTED_TOKENS)
        + U32_SIZE
        + U32_SIZE
        + U32_SIZE // total_opened
        + U32_SIZE // total_claimed
        + (U32_SIZE * 20) // claimed_prizes
        + I64_SIZE
        + I64_SIZE
        + U8_SIZE
        + U8_SIZE;
    pub const SPACE: usize = DISCRIMINATOR_SIZE + Self::INIT_SPACE;
}

#[account]
pub struct PrizeVault {
    pub project: Pubkey,
    pub bump: u8,
}

impl PrizeVault {
    pub const INIT_SPACE: usize = PUBKEY_SIZE + U8_SIZE;
    pub const SPACE: usize = DISCRIMINATOR_SIZE + Self::INIT_SPACE;
}

#[account]
pub struct PrizeItem {
    pub box_config: Pubkey,
    pub index: u8,
    pub prize_type: PrizeType,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub win_percentage: u8,
    pub total_count: u32,
    pub claimed_count: u32,
    pub bump: u8,
}

impl PrizeItem {
    pub const INIT_SPACE: usize = PUBKEY_SIZE
        + U8_SIZE
        + U8_SIZE
        + PUBKEY_SIZE
        + U64_SIZE
        + U8_SIZE
        + U32_SIZE
        + U32_SIZE
        + U8_SIZE;
    pub const SPACE: usize = DISCRIMINATOR_SIZE + Self::INIT_SPACE;
}

#[account]
pub struct BoxReceipt {
    pub user: Pubkey,
    pub box_config: Pubkey,
    pub purchased: u32,
    pub total_opened: u32,
    pub nonce: u64,
    pub request_slot: u64,
    pub pending_opens: u32,
    pub bump: u8,
}

impl BoxReceipt {
    pub const INIT_SPACE: usize =
        PUBKEY_SIZE + PUBKEY_SIZE + U32_SIZE + U32_SIZE + U64_SIZE + U64_SIZE + U32_SIZE + U8_SIZE;
    pub const SPACE: usize = DISCRIMINATOR_SIZE + Self::INIT_SPACE;
}

#[event]
pub struct BoxOpenEvent {
    pub box_config: Pubkey,
    pub user: Pubkey,
    pub prize_index: u8,
    pub slot: u64,
    pub nonce: u64,
    pub roll: u64,
    pub won: bool,
    pub prize_type: PrizeType,
    pub token_mint: Pubkey,
    pub amount_won: u64,
    pub timestamp: i64,
}

pub fn validate_close_authority(
    signer_key: Pubkey,
    project_authority: Pubkey,
    platform_authority: Pubkey,
    rent_claim_mode: u8,
    platform_treasury: Pubkey,
    rent_destination: Pubkey,
) -> Result<()> {
    require!(
        signer_key == project_authority || signer_key == platform_authority,
        crate::errors::MysteryBoxError::Unauthorized
    );
    let expected_dest = if signer_key == platform_authority && rent_claim_mode == 1 {
        platform_treasury
    } else {
        project_authority
    };
    require_keys_eq!(rent_destination, expected_dest, crate::errors::MysteryBoxError::Unauthorized);
    Ok(())
}
