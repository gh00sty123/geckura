use anchor_lang::prelude::*;

#[error_code]
pub enum MysteryBoxError {
    Unauthorized,
    PlatformPaused,
    ProjectInactive,
    BoxNotActive,
    BoxSoldOut,
    BoxAlreadyEnded,
    InsufficientPayment,
    InvalidMint,
    DepositMismatch,
    BoxNotEnded,
    NoPrizeClaimsRemaining,
    BoxHasPendingReceipts,
    InsufficientFunds,
    MathOverflow,
    InvalidWinPercentage,
    SlotHashNotFound,
    ProjectHasActiveBoxes,
    InvalidPrizeIndex,
    PendingPrizesExist,
}
