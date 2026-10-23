//! A Chief machine lends its internet connection to its workspace's agents.
//! The desktop app uses [`public_fetch`] directly; the `chief-machine` command
//! adds pairing and the relay connection for machines without the app.

pub mod public_fetch;

#[cfg(feature = "cli")]
pub mod protocol;
