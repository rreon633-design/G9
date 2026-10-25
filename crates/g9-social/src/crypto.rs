//! One key per room, one AEAD for every frame.
//!
//! The room key is created by whoever starts the room and travels **in the link's
//! fragment**, which browsers never send to a server. The hub therefore routes ciphertext
//! it cannot open — that is the whole point, and it is why a self-hosted hub is safe to
//! hand to someone else.
//!
//! v1 keeps it deliberately simple: one 32-byte key per room, AES-256-GCM (the one AEAD
//! the webview and Rust both have natively), a random
//! 96-bit nonce per frame, and the room id + sender device as associated data so a frame
//! cannot be replayed into another room or attributed to someone else. Per-message ratchets
//! (Megolm) can replace this later without changing the wire format: the body is opaque.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;

use crate::id::{b64, fingerprint, unb64};
use crate::SocialError;

/// The 32-byte secret for one room.
#[derive(Clone, PartialEq, Eq)]
pub struct RoomKey([u8; 32]);

impl RoomKey {
    pub fn generate() -> Self {
        let mut key = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut key);
        Self(key)
    }

    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Base64, for the link fragment and for `social.db`.
    pub fn to_b64(&self) -> String {
        b64(&self.0)
    }

    pub fn from_b64(text: &str) -> Result<Self, SocialError> {
        let raw = unb64(text)?;
        let bytes: [u8; 32] = raw.try_into().map_err(|_| SocialError::Key)?;
        Ok(Self(bytes))
    }

    /// Four groups of four hex characters. Two people read this out loud to confirm they
    /// are in the same room and not, say, in a room a middleman made up.
    pub fn fingerprint(&self) -> String {
        fingerprint(&self.0)
    }

    fn cipher(&self) -> Aes256Gcm {
        Aes256Gcm::new((&self.0).into())
    }

    /// Encrypt `plaintext` with `aad` bound to it. Returns base64(nonce ‖ ciphertext).
    pub fn seal(&self, aad: &[u8], plaintext: &[u8]) -> Result<String, SocialError> {
        let mut nonce = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce);
        let sealed = self
            .cipher()
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: plaintext,
                    aad,
                },
            )
            .map_err(|_| SocialError::Decrypt)?;
        let mut out = Vec::with_capacity(12 + sealed.len());
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&sealed);
        Ok(b64(&out))
    }

    /// Seal with a caller-chosen nonce. Only for test vectors — the same plaintext sealed
    /// twice must never share a nonce in real use, so the public API always randomises.
    pub fn seal_with_nonce(
        &self,
        nonce: &[u8; 12],
        aad: &[u8],
        plaintext: &[u8],
    ) -> Result<String, SocialError> {
        let sealed = self
            .cipher()
            .encrypt(
                Nonce::from_slice(nonce),
                Payload {
                    msg: plaintext,
                    aad,
                },
            )
            .map_err(|_| SocialError::Decrypt)?;
        let mut out = Vec::with_capacity(12 + sealed.len());
        out.extend_from_slice(nonce);
        out.extend_from_slice(&sealed);
        Ok(b64(&out))
    }

    /// The inverse. Wrong key, wrong aad or a tampered frame are all `Decrypt`.
    pub fn open(&self, aad: &[u8], sealed_b64: &str) -> Result<Vec<u8>, SocialError> {
        let raw = unb64(sealed_b64)?;
        if raw.len() < 13 {
            return Err(SocialError::Decrypt);
        }
        let (nonce, body) = raw.split_at(12);
        self.cipher()
            .decrypt(Nonce::from_slice(nonce), Payload { msg: body, aad })
            .map_err(|_| SocialError::Decrypt)
    }
}

impl std::fmt::Debug for RoomKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "RoomKey({})", self.fingerprint())
    }
}

/// The associated data for a frame: which room, who sent it, what kind of thing it is.
/// Binding all three means a replayed frame cannot be moved to another room, and a
/// forwarded frame cannot be re-attributed.
pub fn frame_aad(room: &str, sender: &str, kind: &str) -> Vec<u8> {
    format!("g9-frame|v1|{room}|{sender}|{kind}").into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_and_open_round_trip() {
        let key = RoomKey::generate();
        let aad = frame_aad("r1", "g9:abc", "chat");
        let sealed = key.seal(&aad, b"hello there").unwrap();
        assert_eq!(key.open(&aad, &sealed).unwrap(), b"hello there");
    }

    #[test]
    fn every_frame_gets_a_fresh_nonce() {
        let key = RoomKey::generate();
        let aad = frame_aad("r1", "g9:abc", "chat");
        let a = key.seal(&aad, b"same").unwrap();
        let b = key.seal(&aad, b"same").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn wrong_room_sender_or_key_is_refused() {
        let key = RoomKey::generate();
        let sealed = key.seal(&frame_aad("r1", "g9:abc", "chat"), b"x").unwrap();
        assert!(key
            .open(&frame_aad("r2", "g9:abc", "chat"), &sealed)
            .is_err());
        assert!(key
            .open(&frame_aad("r1", "g9:zzz", "chat"), &sealed)
            .is_err());
        assert!(key
            .open(&frame_aad("r1", "g9:abc", "call"), &sealed)
            .is_err());
        assert!(RoomKey::generate()
            .open(&frame_aad("r1", "g9:abc", "chat"), &sealed)
            .is_err());
    }

    #[test]
    fn tampering_is_detected() {
        let key = RoomKey::generate();
        let aad = frame_aad("r1", "g9:abc", "chat");
        let sealed = key.seal(&aad, b"transfer 1 coin").unwrap();
        let mut raw = unb64(&sealed).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 0x01;
        assert!(key.open(&aad, &b64(&raw)).is_err());
    }

    #[test]
    fn keys_survive_a_link() {
        let key = RoomKey::generate();
        assert_eq!(RoomKey::from_b64(&key.to_b64()).unwrap(), key);
        assert!(RoomKey::from_b64("short").is_err());
    }
}
