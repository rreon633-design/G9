//! Local JSON IPC (127.0.0.1 only). One JSON object per line.

use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use tauri::{AppHandle, Emitter};

pub const ADDR: &str = "127.0.0.1:18765";

pub fn spawn(handle: AppHandle) {
    std::thread::Builder::new()
        .name("g9-ipc".into())
        .spawn(move || serve(handle))
        .ok();
}

fn serve(handle: AppHandle) {
    let Ok(listener) = TcpListener::bind(ADDR) else {
        return;
    };
    listener.set_nonblocking(false).ok();
    for stream in listener.incoming().flatten() {
        if stream
            .peer_addr()
            .map(|a| !a.ip().is_loopback())
            .unwrap_or(true)
        {
            continue;
        }
        let h = handle.clone();
        std::thread::spawn(move || {
            let mut stream = stream;
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            while reader.read_line(&mut line).unwrap_or(0) > 0 {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
                        let _ = h.emit("g9-ipc", v);
                        let _ = writeln!(stream, "{{\"ok\":true}}");
                    } else {
                        let _ = writeln!(stream, "{{\"ok\":false,\"error\":\"invalid json\"}}");
                    }
                }
                line.clear();
            }
        });
    }
}
