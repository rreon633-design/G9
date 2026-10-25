//! `g9-hub` — the G9 Social hub, as one binary.
//!
//! ```text
//! g9-hub                    # 0.0.0.0:8787
//! g9-hub 127.0.0.1:9000     # a specific address
//! PORT=8787 g9-hub
//! ```
//!
//! Put it behind TLS (Caddy, nginx, Cloudflare Tunnel) before sharing links outside your
//! own network: the link tells clients to use `wss://`, and `ws://` is only right for a
//! hub on the LAN.

use std::net::SocketAddr;

use g9_hub::{serve, Hub};

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let arg = std::env::args().nth(1);
    let addr: SocketAddr = match arg {
        Some(text) => text.parse().unwrap_or_else(|_| {
            eprintln!("not an address: {text}");
            std::process::exit(2);
        }),
        None => {
            let port: u16 = std::env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(8787);
            SocketAddr::from(([0, 0, 0, 0], port))
        }
    };
    serve(Hub::new(), addr).await
}
