//! Who you are: one Ed25519 key pair, an id derived from it, and the signature that proves
//! a connection is really you.
//!
//! There is no account, no password and no directory. The private key never leaves the
//! machine (the app wraps it with DPAPI); the public key travels in every invite.

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use rand::rngs::OsRng;

use crate::id::{b64, g9_id, unb64};
use crate::SocialError;

/// A person's signing key.
pub struct Identity {
    signing: SigningKey,
}

impl Identity {
    /// A brand-new identity. Called once, on first run.
    pub fn generate() -> Self {
        Self {
            signing: SigningKey::generate(&mut OsRng),
        }
    }

    /// Rebuild from the 32 stored secret bytes.
    pub fn from_secret_bytes(bytes: &[u8; 32]) -> Self {
        Self {
            signing: SigningKey::from_bytes(bytes),
        }
    }

    /// The 32 bytes to hand to the keystore. Nothing else is secret.
    pub fn secret_bytes(&self) -> [u8; 32] {
        self.signing.to_bytes()
    }

    pub fn public_key(&self) -> VerifyingKey {
        self.signing.verifying_key()
    }

    /// The public key, base64. Goes into invites so they verify without a server.
    pub fn public_b64(&self) -> String {
        b64(self.public_key().as_bytes())
    }

    /// `g9:…` — the name other people will see.
    pub fn id(&self) -> String {
        g9_id(self.public_key().as_bytes())
    }

    /// Sign arbitrary bytes; returns base64.
    pub fn sign_b64(&self, message: &[u8]) -> String {
        b64(&self.signing.sign(message).to_bytes())
    }
}

impl std::fmt::Debug for Identity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never print the secret, even in a panic message.
        write!(f, "Identity({})", self.id())
    }
}

/// Check a signature against a base64 public key. False on any malformed input.
pub fn verify_b64(public_b64: &str, message: &[u8], signature_b64: &str) -> bool {
    let Ok(public) = unb64(public_b64) else {
        return false;
    };
    let Ok(public) = VerifyingKey::from_bytes(&match public.try_into() {
        Ok(bytes) => bytes,
        Err(_) => return false,
    }) else {
        return false;
    };
    let Ok(signature) = unb64(signature_b64) else {
        return false;
    };
    let Ok(signature) = Signature::from_slice(&signature) else {
        return false;
    };
    public.verify_strict(message, &signature).is_ok()
}

/// The exact string a client signs when it opens a hub connection. Both sides build it
/// from the same parts, in the same order, so there is no room for disagreement.
pub fn hello_canonical(room: &str, device: &str, ts: i64, nonce: &str) -> String {
    format!("g9-hello|v1|{room}|{device}|{ts}|{nonce}")
}

/// A device id is derived from its public key, so a hub cannot be told a false one.
pub fn device_id_for(public_b64: &str) -> Result<String, SocialError> {
    let public = unb64(public_b64)?;
    Ok(g9_id(&public))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signatures_round_trip() {
        let me = Identity::generate();
        let msg = hello_canonical("room1", &me.id(), 1_700_000_000, "n0nce");
        let sig = me.sign_b64(msg.as_bytes());
        assert!(verify_b64(&me.public_b64(), msg.as_bytes(), &sig));
    }

    #[test]
    fn a_changed_message_or_key_fails() {
        let me = Identity::generate();
        let other = Identity::generate();
        let sig = me.sign_b64(b"hello");
        assert!(!verify_b64(&me.public_b64(), b"hello!", &sig));
        assert!(!verify_b64(&other.public_b64(), b"hello", &sig));
        assert!(!verify_b64("nonsense", b"hello", &sig));
        assert!(!verify_b64(&me.public_b64(), b"hello", "nonsense"));
    }

    #[test]
    fn identity_survives_a_restart() {
        let me = Identity::generate();
        let bytes = me.secret_bytes();
        let again = Identity::from_secret_bytes(&bytes);
        assert_eq!(me.id(), again.id());
        assert_eq!(me.public_b64(), again.public_b64());
    }

    #[test]
    fn device_ids_track_the_key() {
        let me = Identity::generate();
        assert_eq!(device_id_for(&me.public_b64()).unwrap(), me.id());
        assert!(me.id().len() <= 30);
    }
}
