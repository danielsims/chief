use std::sync::Mutex;

mod auth_session;
mod native_notifications;
mod relay_identity;

use auth_session::{clear_oauth_session, load_oauth_session, store_oauth_session};
use native_notifications::{
    notification_environment, request_native_notification_permission, show_native_notification,
};
use relay_identity::{relay_nip98_authorization, relay_public_key};

#[derive(Default)]
struct PendingNotificationActivation(Mutex<Option<serde_json::Value>>);

impl PendingNotificationActivation {
    fn set(&self, target: serde_json::Value) {
        if let Ok(mut pending) = self.0.lock() {
            *pending = Some(target);
        }
    }

    fn take(&self) -> Option<serde_json::Value> {
        self.0.lock().ok()?.take()
    }
}

fn focus_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn activate_app_window(app: tauri::AppHandle) {
    focus_main_window(&app);
}

#[tauri::command]
fn take_pending_notification_activation(
    state: tauri::State<'_, PendingNotificationActivation>,
) -> Option<serde_json::Value> {
    state.take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::{Emitter, Manager};

    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(PendingNotificationActivation::default());
            focus_main_window(&handle);
            Ok(())
        })
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            focus_main_window(app);
            if let Some(url) = args
                .into_iter()
                .find(|argument| argument.starts_with("chief-desktop://"))
            {
                let _ = app.emit("deep-link://new-url", vec![url]);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            activate_app_window,
            notification_environment,
            request_native_notification_permission,
            show_native_notification,
            load_oauth_session,
            store_oauth_session,
            clear_oauth_session,
            relay_public_key,
            relay_nip98_authorization,
            take_pending_notification_activation
        ])
        .run(tauri::generate_context!())
        .expect("error while running Chief");
}
