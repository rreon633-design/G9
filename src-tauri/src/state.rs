use std::sync::Mutex;

use g9_store::Store;
use tauri::{AppHandle, Manager};

pub struct AppState {
    pub store: Mutex<Store>,
}

impl AppState {
    pub fn init(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&dir)?;
        let db = dir.join("g9.db");
        let store = Store::open(&db)?;
        Ok(Self {
            store: Mutex::new(store),
        })
    }
}
