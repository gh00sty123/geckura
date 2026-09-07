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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq)]
pub enum ManagePrizeAction {
    Deposit,
    Withdraw,
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
    pub project_id: u64,
    pub authority: Pubkey,
    pub fee_wallet: Pubkey,
    pub fee_lamports: u64,
    pub is_active: bool,
    pub bump: u8,
    // 0 = project authority claims ATA rent, 1 = platform treasury claims ATA rent
    pub rent_claim_mode: u8,
    pub fee_wallet_2: Pubkey,
    pub active_boxes_count: u32,
    // Reserved padding for future schema fields
    pub reserved: [u8; 27],
}

impl Project {
    pub const INIT_SPACE: usize = U64_SIZE
        + PUBKEY_SIZE
        + PUBKEY_SIZE
        + U64_SIZE
        + BOOL_SIZE
        + U8_SIZE
        + U8_SIZE // rent_claim_mode
        + PUBKEY_SIZE
        + U32_SIZE
        + 27; // reserved padding
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
    pub prizes_count: u8,
    pub prizes: [PrizeItem; 20],
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
        + U8_SIZE
        + U8_SIZE // prizes_count
        + (20 * PrizeItem::INIT_SPACE);
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq)]
pub struct PrizeItem {
    pub index: u8,
    pub prize_type: PrizeType,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub win_percentage: u8,
    pub total_count: u32,
    pub claimed_count: u32,
}

impl Default for PrizeItem {
    fn default() -> Self {
        Self {
            index: 0,
            prize_type: PrizeType::Sol,
            token_mint: Pubkey::default(),
            amount: 0,
            win_percentage: 0,
            total_count: 0,
            claimed_count: 0,
        }
    }
}

impl PrizeItem {
    pub const INIT_SPACE: usize = U8_SIZE
        + U8_SIZE
        + PUBKEY_SIZE
        + U64_SIZE
        + U8_SIZE
        + U32_SIZE
        + U32_SIZE;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq)]
pub struct ClaimablePrize {
    pub box_id: u64,
    pub prize_index: u8,
    pub prize_type: PrizeType,
    pub amount: u64,
}

impl Default for ClaimablePrize {
    fn default() -> Self {
        Self {
            box_id: 0,
            prize_index: 0,
            prize_type: PrizeType::Sol,
            amount: 0,
        }
    }
}

impl ClaimablePrize {
    pub const INIT_SPACE: usize = U64_SIZE  // box_id
        + U8_SIZE                          // prize_index
        + U8_SIZE                          // prize_type
        + U64_SIZE;                        // amount
}

#[account]
pub struct BoxReceipt {
    pub user: Pubkey,
    pub project: Pubkey,
    pub purchased: u32,
    pub total_opened: u32,
    pub nonce: u64,
    pub claimable_count: u8,
    pub claimable_prizes: [ClaimablePrize; 20],
    pub bump: u8,
}

impl BoxReceipt {
    pub const MAX_CLAIMABLE_PRIZES: usize = 20;
    pub const INIT_SPACE: usize = PUBKEY_SIZE // user
        + PUBKEY_SIZE                      // project
        + U32_SIZE                         // purchased
        + U32_SIZE                         // total_opened
        + U64_SIZE                         // nonce
        + U8_SIZE                          // claimable_count
        + (Self::MAX_CLAIMABLE_PRIZES * ClaimablePrize::INIT_SPACE)
        + U8_SIZE;                         // bump
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
