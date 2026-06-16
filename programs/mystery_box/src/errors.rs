use anchor_lang::prelude::*;

#[error_code]
pub enum MysteryBoxError {
    #[msg("The signer is not authorized to perform this action.")]
    Unauthorized,
    #[msg("The platform is paused.")]
    PlatformPaused,
    #[msg("The project is inactive.")]
    ProjectInactive,
    #[msg("The box is not active.")]
    BoxNotActive,
    #[msg("The box is sold out.")]
    BoxSoldOut,
    #[msg("The box sale has already ended.")]
    BoxAlreadyEnded,
    #[msg("The payment amount is insufficient.")]
    InsufficientPayment,
    #[msg("Prize type does not match the prize item configuration.")]
    InvalidPrizeType,
    #[msg("Token mint does not match the prize item configuration.")]
    InvalidMint,
    #[msg("Deposit amount does not match the required total.")]
    DepositMismatch,
    #[msg("Box is still active or has not ended yet.")]
    BoxNotEnded,
    #[msg("Prize item has no remaining claims.")]
    NoPrizeClaimsRemaining,
    #[msg("Box has unopened purchases and cannot be closed.")]
    BoxHasPendingReceipts,
    #[msg("Slug can only contain lowercase letters, numbers, and hyphens.")]
    InvalidSlug,
    #[msg("Insufficient funds in the vault.")]
    InsufficientFunds,
    #[msg("Math overflow error.")]
    MathOverflow,
    #[msg("Token account is not empty. Withdraw all tokens before closing.")]
    TokenAccountNotEmpty,
    #[msg("Win percentage must be between 0 and 100.")]
    InvalidWinPercentage,
    #[msg("There is already a pending open request.")]
    AlreadyPendingReveal,
    #[msg("No pending open request found.")]
    NoPendingReveal,
    #[msg("Reveal must happen in a later block/slot than request.")]
    SameSlotReveal,
    #[msg("Blockhash for the request slot not found.")]
    SlotHashNotFound,
    #[msg("Open request has expired (older than 512 blocks).")]
    RequestExpired,
    #[msg("No purchased boxes available to open.")]
    NoPurchasedBoxes,
}
