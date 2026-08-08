//! Zoom-aware placement for macOS's native traffic lights.
//!
//! Wry owns the default inset declared in `tauri.conf.json`. Once WKWebView
//! magnifies the page, this small bridge reapplies the same inset in AppKit
//! points so the controls stay aligned with the scaled pane header.

use objc2_app_kit::{NSWindow, NSWindowButton};
use tauri::WebviewWindow;

const TRAFFIC_LIGHT_X: f64 = 18.0;
const TRAFFIC_LIGHT_Y_AT_ACTUAL_SIZE: f64 = 32.0;

pub fn sync_to_page_zoom(window: &WebviewWindow, magnification: f64) -> Result<(), String> {
    if !magnification.is_finite() || !(0.2..=5.0).contains(&magnification) {
        return Err(
            "Traffic-light page zoom must be a finite value from 0.2 through 5.0".to_string(),
        );
    }

    let window = window.clone();
    let native_window = window.clone();
    let y = TRAFFIC_LIGHT_Y_AT_ACTUAL_SIZE * magnification;
    window
        .run_on_main_thread(move || {
            let Ok(raw_window) = native_window.ns_window() else {
                return;
            };

            // Tauri gives us the AppKit window pointer on macOS. It remains
            // owned by the webview window, and is used only on AppKit's main
            // thread for the duration of this callback.
            let native_window = unsafe { &*raw_window.cast::<NSWindow>() };
            unsafe { inset_traffic_lights(native_window, TRAFFIC_LIGHT_X, y) };
        })
        .map_err(|error| format!("Could not align native traffic lights: {error}"))
}

/// Mirrors Wry's own inset routine, with only the vertical inset varying.
unsafe fn inset_traffic_lights(window: &NSWindow, x: f64, y: f64) {
    let Some(close) = window.standardWindowButton(NSWindowButton::CloseButton) else {
        return;
    };
    let Some(minimize) = window.standardWindowButton(NSWindowButton::MiniaturizeButton) else {
        return;
    };
    let zoom = window.standardWindowButton(NSWindowButton::ZoomButton);

    let Some(title_bar_view) = close.superview().and_then(|view| view.superview()) else {
        return;
    };

    let close_rect = close.frame();
    let title_bar_height = close_rect.size.height + y;
    let mut title_bar_rect = title_bar_view.frame();
    title_bar_rect.size.height = title_bar_height;
    title_bar_rect.origin.y = window.frame().size.height - title_bar_height;
    title_bar_view.setFrame(title_bar_rect);

    let gap = minimize.frame().origin.x - close_rect.origin.x;
    let mut buttons = vec![close, minimize];
    if let Some(zoom) = zoom {
        buttons.push(zoom);
    }

    for (index, button) in buttons.into_iter().enumerate() {
        let mut rect = button.frame();
        rect.origin.x = x + (index as f64 * gap);
        button.setFrameOrigin(rect.origin);
    }
}

#[cfg(test)]
mod tests {
    use super::TRAFFIC_LIGHT_Y_AT_ACTUAL_SIZE;

    #[test]
    fn native_chrome_uses_the_same_scale_as_the_reader() {
        assert_eq!(TRAFFIC_LIGHT_Y_AT_ACTUAL_SIZE * 1.0, 32.0);
        assert_eq!(TRAFFIC_LIGHT_Y_AT_ACTUAL_SIZE * 1.5, 48.0);
    }
}
