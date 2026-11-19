//! A Chief machine lends its internet connection to its workspace's agents.
//! The desktop app uses [`public_fetch`] directly; the `chief-machine` command
//! adds pairing and the relay connection for machines without the app.

pub mod public_fetch;

#[cfg(feature = "cli")]
pub mod protocol;

#[cfg(feature = "cli")]
pub mod agent_adapter;
#[cfg(feature = "cli")]
pub mod browser;
#[cfg(feature = "cli")]
pub mod browser_proxy;
#[cfg(feature = "cli")]
pub mod host_storage;
#[cfg(feature = "cli")]
pub mod machine;
#[cfg(feature = "cli")]
pub mod relay_http;

#[cfg(all(feature = "cli", target_os = "linux"))]
mod browser_agent;
#[cfg(all(feature = "cli", target_os = "linux"))]
mod browser_cdp;
#[cfg(all(feature = "cli", target_os = "linux"))]
pub mod browser_host;
#[cfg(all(feature = "cli", target_os = "linux"))]
mod browser_launch;
#[cfg(all(feature = "cli", target_os = "linux"))]
mod browser_media;
#[cfg(all(feature = "cli", target_os = "linux"))]
mod browser_stream;

#[cfg(feature = "cli")]
mod agent_identity;
#[cfg(feature = "cli")]
pub mod owned_agent;
