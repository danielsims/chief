use std::{
    process::Child,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use super::{
    record_runtime_process, restart_at, runtime_is_running, runtime_port_is_open,
    runtime_unhealthy_grace, spawn_agent_runtime, terminate_runtime,
    terminate_unrecognized_runtime_on_port, RUNTIME_PORT,
};

pub(crate) fn spawn(
    app: tauri::AppHandle,
    stop: Arc<AtomicBool>,
    restart: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut child: Option<Child> = None;
        let mut unhealthy_since: Option<Instant> = None;
        let mut healthy_since: Option<Instant> = None;
        let mut has_been_healthy = false;
        let mut restart_delay = Duration::from_secs(1);
        let mut next_spawn_at = Instant::now();

        while !stop.load(Ordering::Relaxed) {
            let now = Instant::now();
            if restart.swap(false, Ordering::Relaxed) {
                if let Some(runtime) = child.as_mut() {
                    terminate_runtime(runtime);
                }
                child = None;
                unhealthy_since = None;
                healthy_since = None;
                has_been_healthy = false;
                restart_delay = Duration::from_secs(1);
                next_spawn_at = now;
                eprintln!("[runtime] manual recovery requested");
            }
            if let Some(runtime) = child.as_mut() {
                match runtime.try_wait() {
                    Ok(Some(status)) => {
                        eprintln!("[runtime] agent runtime exited with {status}; restarting");
                        child = None;
                        unhealthy_since = None;
                        healthy_since = None;
                        has_been_healthy = false;
                        next_spawn_at = restart_at(&mut restart_delay);
                    }
                    Ok(None) => {
                        if runtime_is_running() {
                            has_been_healthy = true;
                            unhealthy_since = None;
                            let became_healthy = healthy_since.get_or_insert(now);
                            if became_healthy.elapsed() >= Duration::from_secs(30) {
                                restart_delay = Duration::from_secs(1);
                            }
                        } else {
                            healthy_since = None;
                            let became_unhealthy = unhealthy_since.get_or_insert(now);
                            let grace = runtime_unhealthy_grace(has_been_healthy);
                            if became_unhealthy.elapsed() >= grace {
                                eprintln!("[runtime] agent runtime is unhealthy; restarting");
                                terminate_runtime(runtime);
                                child = None;
                                unhealthy_since = None;
                                has_been_healthy = false;
                                next_spawn_at = restart_at(&mut restart_delay);
                            }
                        }
                    }
                    Err(error) => {
                        eprintln!("[runtime] could not inspect agent runtime: {error}; restarting");
                        terminate_runtime(runtime);
                        child = None;
                        unhealthy_since = None;
                        healthy_since = None;
                        has_been_healthy = false;
                        next_spawn_at = restart_at(&mut restart_delay);
                    }
                }
            } else if runtime_is_running() {
                // A developer-run runtime may already own the port. Leave it
                // alone while healthy, but take over if it later disappears.
                restart_delay = Duration::from_secs(1);
                next_spawn_at = now;
            } else if runtime_port_is_open() {
                if now >= next_spawn_at {
                    if terminate_unrecognized_runtime_on_port() {
                        next_spawn_at = now + Duration::from_millis(500);
                    } else {
                        eprintln!(
                            "[runtime] port {RUNTIME_PORT} is owned by another process; waiting"
                        );
                        next_spawn_at = restart_at(&mut restart_delay);
                    }
                }
            } else if now >= next_spawn_at {
                child = spawn_agent_runtime(&app);
                if child.is_some() {
                    if let Some(runtime) = child.as_ref() {
                        record_runtime_process(&app, runtime.id());
                    }
                    unhealthy_since = Some(now);
                    healthy_since = None;
                    has_been_healthy = false;
                } else {
                    next_spawn_at = restart_at(&mut restart_delay);
                }
            }

            thread::sleep(Duration::from_millis(500));
        }

        if let Some(runtime) = child.as_mut() {
            terminate_runtime(runtime);
        }
    })
}
