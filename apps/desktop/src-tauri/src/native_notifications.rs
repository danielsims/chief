use std::env;

use tauri::AppHandle;
#[cfg(not(target_os = "macos"))]
use tauri_plugin_notification::NotificationExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotificationEnvironment {
    bundled: bool,
    native_permission_checks: bool,
    authorization_status: Option<&'static str>,
    alerts_enabled: Option<bool>,
    sounds_enabled: Option<bool>,
    notification_center_enabled: Option<bool>,
}

#[cfg(target_os = "macos")]
fn setting_enabled(status: mac_usernotifications::NotificationSettingStatus) -> Option<bool> {
    use mac_usernotifications::NotificationSettingStatus;

    match status {
        NotificationSettingStatus::Enabled => Some(true),
        NotificationSettingStatus::Disabled => Some(false),
        NotificationSettingStatus::NotSupported | NotificationSettingStatus::Unknown => None,
    }
}

#[cfg(target_os = "macos")]
fn authorization_status(status: mac_usernotifications::AuthorizationStatus) -> &'static str {
    use mac_usernotifications::AuthorizationStatus;

    match status {
        AuthorizationStatus::NotDetermined => "notDetermined",
        AuthorizationStatus::Denied => "denied",
        AuthorizationStatus::Authorized => "authorized",
        AuthorizationStatus::Provisional => "provisional",
        AuthorizationStatus::Ephemeral => "ephemeral",
        AuthorizationStatus::Unknown => "unknown",
    }
}

#[tauri::command]
pub(crate) fn notification_environment(_app: AppHandle) -> NotificationEnvironment {
    let executable = env::current_exe().unwrap_or_default();
    let bundled = executable
        .components()
        .any(|component| component.as_os_str() == "Contents");

    #[cfg(target_os = "macos")]
    {
        let settings = mac_usernotifications::blocking::get_notification_settings().ok();
        return NotificationEnvironment {
            bundled,
            native_permission_checks: true,
            authorization_status: settings
                .map(|value| authorization_status(value.authorization_status)),
            alerts_enabled: settings.and_then(|value| setting_enabled(value.alert_enabled)),
            sounds_enabled: settings.and_then(|value| setting_enabled(value.sound_enabled)),
            notification_center_enabled: settings
                .and_then(|value| setting_enabled(value.notification_center_enabled)),
        };
    }

    #[cfg(not(target_os = "macos"))]
    NotificationEnvironment {
        bundled,
        native_permission_checks: false,
        authorization_status: None,
        alerts_enabled: None,
        sounds_enabled: None,
        notification_center_enabled: None,
    }
}

#[tauri::command]
pub(crate) fn request_native_notification_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        return mac_usernotifications::blocking::request_auth()
            .map_err(|error| format!("macOS notification permission failed: {error}"));
    }

    #[cfg(not(target_os = "macos"))]
    Ok(false)
}

#[tauri::command]
pub(crate) fn show_native_notification(
    app: AppHandle,
    title: String,
    body: String,
    target: Option<serde_json::Value>,
    sound: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri::{Emitter, Manager};

        let mut notification = mac_usernotifications::Notification::new()
            .title(title)
            .message(body);
        if sound {
            notification = notification.sound("Glass");
        }
        let handle = notification
            .send_blocking()
            .map_err(|error| format!("native notification delivery failed: {error}"))?;
        if let Some(target) = target {
            std::thread::spawn(move || {
                let response = mac_usernotifications::block_on(handle.response());
                if !matches!(response, Ok(ref value) if value.is_default_action()) {
                    return;
                }
                app.state::<crate::PendingNotificationActivation>()
                    .set(target);
                crate::focus_main_window(&app);
                let _ = app.emit("chief-notification-activated", ());
            });
        }
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let mut notification = app.notification().builder().title(&title).body(&body);
        if sound {
            notification = notification.sound("default");
        }
        notification
            .show()
            .map_err(|error| format!("native notification delivery failed: {error}"))
    }
}
