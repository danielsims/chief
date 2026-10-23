//! Lets this computer fetch public web pages for its workspace's agents. The
//! guard that keeps every fetch on the public internet lives in the shared
//! `chief-machine` crate, which headless machines run too.

use chief_machine::public_fetch::{fetch, Fetched};

#[tauri::command]
pub async fn machine_web_fetch(url: String) -> Result<Fetched, String> {
    fetch(&url).await
}
