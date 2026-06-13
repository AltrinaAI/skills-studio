//! Ship-time feature switches. Each const gates a finished feature at one
//! choke point, so turning it on for the next release is a one-line flip.

/// App auto-update. Off until the update channel is settled: the feed URL and
/// signing pubkey are baked permanently into every updater-enabled build, so
/// flipping this on locks in both for the whole shipped fleet. While off, the
/// release checker never starts — no polling, no banner, `apply` refuses.
pub const AUTO_UPDATE: bool = false;
