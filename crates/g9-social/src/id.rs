//! Small encodings shared by everything else: base64url, random ids, the `g9:` id.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};

use crate::SocialError;

/// URL-safe base64 without padding — safe in query strings, links and file names.
pub fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// The inverse. A malformed string is an error, never a panic.
pub fn unb64(text: &str) -> Result<Vec<u8>, SocialError> {
    URL_SAFE_NO_PAD
        .decode(text.trim())
        .map_err(|_| SocialError::Key)
}

/// `n` random bytes, base64url encoded. Used for room ids, tokens and nonces.
pub fn random_b64(n: usize) -> String {
    let mut buf = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut buf);
    b64(&buf)
}

/// The public identity string: `g9:` + the first 20 bytes of SHA-256 over the public key.
/// Twenty bytes keeps it inside 27 characters — short enough to put in a message.
pub fn g9_id(public_key: &[u8]) -> String {
    let digest = Sha256::digest(public_key);
    format!("g9:{}", b64(&digest[..20]))
}

/// The tail of an id, for places where the whole thing does not fit.
pub fn short_id(id: &str) -> String {
    let body = id.strip_prefix("g9:").unwrap_or(id);
    let n = body.len().min(8);
    body[body.len() - n..].to_string()
}

/// A fingerprint for a room key or a public key, in four groups of four: `1a2b·3c4d·…`.
/// This is what two people read to each other when they want to be sure.
pub fn fingerprint(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let hex: String = digest[..8].iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}·{}·{}·{}",
        &hex[0..4],
        &hex[4..8],
        &hex[8..12],
        &hex[12..16]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trips_and_rejects_junk() {
        let raw = b"g9 social";
        assert_eq!(unb64(&b64(raw)).unwrap(), raw);
        assert!(unb64("not base64!").is_err());
    }

    #[test]
    fn ids_are_stable_and_shorter_than_a_paragraph() {
        let a = g9_id(&[7u8; 32]);
        assert_eq!(a, g9_id(&[7u8; 32]));
        assert_ne!(a, g9_id(&[8u8; 32]));
        assert!(a.starts_with("g9:"));
        assert!(a.len() <= 30, "id grew to {}", a.len());
        assert_eq!(short_id(&a).len(), 8);
    }

    #[test]
    fn random_ids_differ() {
        assert_ne!(random_b64(16), random_b64(16));
    }

    #[test]
    fn fingerprint_is_readable() {
        let f = fingerprint(&[1u8; 32]);
        assert_eq!(f.split('·').count(), 4);
        assert_eq!(f.replace('·', "").len(), 16);
    }
}
