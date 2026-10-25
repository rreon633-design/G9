//! One link to join. It carries the hub, the room, the seat count, the issuer and the
//! room key — and it is signed, so a link that was edited in transit is refused instead of
//! silently taking you to someone else's hub.
//!
//! ```text
//! g9://join?v=1&kind=room&h=wss%3A%2F%2Fhub.example&r=K7f2Q1x9&t=tok&s=9&e=1761…&i=g9%3A…&p=…&x=…
//!         #k=<room key>
//! ```
//!
//! The key lives in the **fragment**, which no browser or HTTP client ever sends to a
//! server. The hub therefore knows the room exists but not how to read it.

use serde::{Deserialize, Serialize};
use url::Url;

use crate::crypto::RoomKey;
use crate::id::{b64, g9_id, unb64};
use crate::identity::{verify_b64, Identity};
use crate::SocialError;

pub const INVITE_VERSION: u32 = 1;

/// What the link is for. One link shape, three jobs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InviteKind {
    /// Join a room: a thread and its calls.
    Room,
    /// Add me as a contact.
    Contact,
    /// Link another device to this identity.
    Device,
}

impl InviteKind {
    pub fn as_str(self) -> &'static str {
        match self {
            InviteKind::Room => "room",
            InviteKind::Contact => "contact",
            InviteKind::Device => "device",
        }
    }

    pub fn parse(text: &str) -> Result<Self, SocialError> {
        match text {
            "room" => Ok(InviteKind::Room),
            "contact" => Ok(InviteKind::Contact),
            "device" => Ok(InviteKind::Device),
            _ => Err(SocialError::Link),
        }
    }
}

/// A signed invitation. Build it with [`Invite::create`], share it with [`Invite::link`].
#[derive(Debug, Clone)]
pub struct Invite {
    pub v: u32,
    pub kind: InviteKind,
    /// Where the hub lives: `wss://…`, `ws://…` for a LAN hub, or `https://…`.
    pub hub: String,
    pub room: String,
    /// The hub's own bearer token for this invite. The hub needs it; it is not a key.
    pub token: String,
    pub seats: u8,
    /// Unix seconds after which the hub and the clients both refuse it.
    pub exp: i64,
    /// The issuer's `g9:` id.
    pub issuer: String,
    /// The issuer's public key, base64 — so the signature can be checked with no server.
    pub public_key: String,
    pub sig: String,
    pub key: RoomKey,
}

impl Invite {
    /// The exact bytes the issuer signs. Any change to any visible field changes this,
    /// including the room key's fingerprint.
    pub fn canonical(&self) -> String {
        format!(
            "g9-invite|v{}|{}|{}|{}|{}|{}|{}|{}|{}",
            self.v,
            self.kind.as_str(),
            self.hub,
            self.room,
            self.token,
            self.seats,
            self.exp,
            self.issuer,
            self.key.fingerprint()
        )
    }

    /// Build and sign a fresh invite.
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        me: &Identity,
        kind: InviteKind,
        hub: &str,
        room: &str,
        token: &str,
        seats: u8,
        exp: i64,
        key: RoomKey,
    ) -> Self {
        let mut invite = Self {
            v: INVITE_VERSION,
            kind,
            hub: hub.to_string(),
            room: room.to_string(),
            token: token.to_string(),
            seats: seats.max(2),
            exp,
            issuer: me.id(),
            public_key: me.public_b64(),
            sig: String::new(),
            key,
        };
        let sig = me.sign_b64(invite.canonical().as_bytes());
        invite.sig = sig;
        invite
    }

    /// The shareable link. Copy it, QR it, paste it into a message.
    pub fn link(&self) -> String {
        let mut url = Url::parse("g9://join").expect("static url");
        {
            let mut q = url.query_pairs_mut();
            q.append_pair("v", &self.v.to_string());
            q.append_pair("kind", self.kind.as_str());
            q.append_pair("h", &self.hub);
            q.append_pair("r", &self.room);
            q.append_pair("t", &self.token);
            q.append_pair("s", &self.seats.to_string());
            q.append_pair("e", &self.exp.to_string());
            q.append_pair("i", &self.issuer);
            q.append_pair("p", &self.public_key);
            q.append_pair("x", &self.sig);
        }
        url.set_fragment(Some(&format!("k={}", self.key.to_b64())));
        url.to_string()
    }

    /// Parse a link or a QR payload. Does **not** trust it yet — call [`Invite::verify`].
    pub fn parse(link: &str) -> Result<Self, SocialError> {
        let text = link.trim();
        let url = Url::parse(text).map_err(|_| SocialError::Link)?;
        if url.scheme() != "g9" {
            return Err(SocialError::Link);
        }
        let get = |name: &str| -> Option<String> {
            url.query_pairs()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.into_owned())
        };
        let required = |name: &str| get(name).ok_or(SocialError::Link);
        let v: u32 = required("v")?.parse().map_err(|_| SocialError::Link)?;
        if v != INVITE_VERSION {
            return Err(SocialError::Link);
        }
        let kind = InviteKind::parse(&required("kind")?)?;
        let seats: u8 = required("s")?.parse().map_err(|_| SocialError::Link)?;
        let exp: i64 = required("e")?.parse().map_err(|_| SocialError::Link)?;

        let fragment = url.fragment().ok_or(SocialError::Link)?;
        let key_b64 = fragment
            .split('&')
            .find_map(|part| part.strip_prefix("k="))
            .ok_or(SocialError::Link)?;
        let key = RoomKey::from_b64(key_b64)?;

        Ok(Self {
            v,
            kind,
            hub: required("h")?,
            room: required("r")?,
            token: required("t")?,
            seats,
            exp,
            issuer: required("i")?,
            public_key: required("p")?,
            sig: required("x")?,
            key,
        })
    }

    /// Signature, issuer identity and expiry, in that order. Cheap and local: no network
    /// is involved, so a link can be checked before anything connects.
    pub fn verify(&self) -> Result<(), SocialError> {
        if self.v != INVITE_VERSION {
            return Err(SocialError::Link);
        }
        if !verify_b64(&self.public_key, self.canonical().as_bytes(), &self.sig) {
            return Err(SocialError::Tampered);
        }
        let public = unb64(&self.public_key)?;
        if g9_id(&public) != self.issuer {
            return Err(SocialError::WrongIssuer);
        }
        if self.exp <= crate::now() {
            return Err(SocialError::Expired);
        }
        Ok(())
    }

    /// `wss://hub.example` → the HTTP base the app uses for its REST calls, and the WS URL
    /// for the socket. A LAN hub may legitimately be `ws://192.168.1.5:8787`.
    pub fn http_base(&self) -> String {
        let h = self.hub.trim_end_matches('/');
        if let Some(rest) = h.strip_prefix("wss://") {
            format!("https://{rest}")
        } else if let Some(rest) = h.strip_prefix("wss:") {
            format!("https://{rest}")
        } else if let Some(rest) = h.strip_prefix("ws://") {
            format!("http://{rest}")
        } else if h.starts_with("http://") || h.starts_with("https://") {
            h.to_string()
        } else {
            format!("https://{h}")
        }
    }

    /// The socket URL, with a trailing slash removed so paths join cleanly.
    pub fn ws_base(&self) -> String {
        let h = self.hub.trim_end_matches('/');
        if h.starts_with("ws://") || h.starts_with("wss://") {
            h.to_string()
        } else if let Some(rest) = h.strip_prefix("https://") {
            format!("wss://{rest}")
        } else if let Some(rest) = h.strip_prefix("http://") {
            format!("ws://{rest}")
        } else {
            format!("wss://{h}")
        }
    }

    /// What the UI shows before the user commits to joining.
    pub fn preview(&self) -> String {
        format!(
            "{} · room {} · {} seats · key {}",
            self.issuer,
            self.room,
            self.seats,
            self.key.fingerprint()
        )
    }

    /// A compact JSON view for logs and the debug panel. The key is **not** included.
    pub fn to_json(&self) -> String {
        serde_json::json!({
            "v": self.v,
            "kind": self.kind.as_str(),
            "hub": self.hub,
            "room": self.room,
            "seats": self.seats,
            "exp": self.exp,
            "issuer": self.issuer,
            "fingerprint": self.key.fingerprint(),
            "b64": b64(self.room.as_bytes()),
        })
        .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::now;

    fn sample(me: &Identity) -> Invite {
        Invite::create(
            me,
            InviteKind::Room,
            "wss://hub.example",
            "K7f2Q1x9",
            "tok_123",
            9,
            now() + 3600,
            RoomKey::generate(),
        )
    }

    #[test]
    fn a_link_round_trips_with_its_key() {
        let me = Identity::generate();
        let invite = sample(&me);
        let parsed = Invite::parse(&invite.link()).unwrap();
        assert_eq!(parsed.room, "K7f2Q1x9");
        assert_eq!(parsed.seats, 9);
        assert_eq!(parsed.kind, InviteKind::Room);
        assert_eq!(parsed.key, invite.key);
        assert!(parsed.verify().is_ok());
    }

    #[test]
    fn the_key_never_leaves_the_fragment() {
        let me = Identity::generate();
        let link = sample(&me).link();
        let before_hash = link.split('#').next().unwrap();
        assert!(!before_hash.contains(&sample_key_marker()), "key leaked");
        assert!(link.contains("#k="));
        fn sample_key_marker() -> String {
            "k=".to_string()
        }
    }

    #[test]
    fn tampering_is_caught_per_field() {
        let me = Identity::generate();
        let invite = sample(&me);

        let mut wider = invite.clone();
        wider.seats = 32;
        assert!(matches!(wider.verify(), Err(SocialError::Tampered)));

        let mut elsewhere = invite.clone();
        elsewhere.hub = "wss://evil.example".into();
        assert!(matches!(elsewhere.verify(), Err(SocialError::Tampered)));

        let mut other_room = invite.clone();
        other_room.room = "OTHER".into();
        assert!(matches!(other_room.verify(), Err(SocialError::Tampered)));

        // swapping just the key changes the fingerprint, so the signature fails too
        let mut rekeyed = invite.clone();
        rekeyed.key = RoomKey::generate();
        assert!(matches!(rekeyed.verify(), Err(SocialError::Tampered)));
    }

    #[test]
    fn an_expired_link_says_so() {
        let me = Identity::generate();
        let invite = Invite::create(
            &me,
            InviteKind::Room,
            "wss://hub.example",
            "r",
            "t",
            9,
            now() - 1,
            RoomKey::generate(),
        );
        assert!(matches!(invite.verify(), Err(SocialError::Expired)));
    }

    #[test]
    fn a_link_from_someone_else_cannot_claim_my_id() {
        let me = Identity::generate();
        let other = Identity::generate();
        let mut invite = sample(&me);
        invite.issuer = other.id();
        assert!(matches!(invite.verify(), Err(SocialError::Tampered)));
    }

    #[test]
    fn junk_is_refused_without_panicking() {
        for junk in [
            "",
            "hello",
            "https://example.com",
            "g9://join?v=1",
            "g9://join?v=9&kind=room&h=x&r=y&t=z&s=9&e=1&i=i&p=p&x=x#k=AAAA",
        ] {
            assert!(Invite::parse(junk).is_err(), "accepted {junk:?}");
        }
    }

    #[test]
    fn hub_urls_normalise_both_ways() {
        let me = Identity::generate();
        let mut invite = sample(&me);
        invite.hub = "wss://hub.example".into();
        assert_eq!(invite.http_base(), "https://hub.example");
        assert_eq!(invite.ws_base(), "wss://hub.example");
        invite.hub = "http://192.168.1.5:8787".into();
        assert_eq!(invite.http_base(), "http://192.168.1.5:8787");
        assert_eq!(invite.ws_base(), "ws://192.168.1.5:8787");
    }
}
