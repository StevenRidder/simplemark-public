//! Native browser-style pinch magnification for the macOS webview.
//!
//! The document and SimpleMark's controls live in one WKWebView, just as a web
//! application such as Google Docs lives within a browser page. AppKit/WebKit
//! therefore own the complete visual scale, layout, scrolling, and hit-testing
//! rather than trying to imitate browser zoom with a DOM reflow or transform.

use std::{cell::RefCell, ptr::NonNull};

use block2::RcBlock;
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSEvent, NSEventMask, NSEventType};
use objc2_web_kit::WKWebView;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

thread_local! {
    /// AppKit keeps the monitor alive through its opaque token. This is main
    /// thread-local because AppKit event monitors may only be installed and
    /// removed from the main event loop.
    static MAGNIFICATION_MONITOR: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
}

/// Enables the built-in WKWebView magnify gesture and its persistence tracker.
pub fn enable(window: &WebviewWindow) -> Result<(), String> {
    let app = window.app_handle().clone();
    window
        .with_webview(move |webview| unsafe {
            let view: &WKWebView = &*webview.inner().cast();
            view.setAllowsMagnification(true);
            install_magnification_monitor(app);
        })
        .map_err(|error| format!("Could not enable native page magnification: {error}"))
}

/// Restores the persisted native magnification, or resets it through Actual Size.
pub fn set_magnification(window: &WebviewWindow, magnification: f64) -> Result<(), String> {
    if !magnification.is_finite() || !(0.2..=5.0).contains(&magnification) {
        return Err(
            "Native page magnification must be a finite value from 0.2 through 5.0".to_string(),
        );
    }

    window
        .with_webview(move |webview| unsafe {
            let view: &WKWebView = &*webview.inner().cast();
            if magnification == 1.0 {
                view.setPageZoom(1.0);
            }
            view.setMagnification(magnification);
        })
        .map_err(|error| format!("Could not set native page magnification: {error}"))
}

fn install_magnification_monitor(app: AppHandle) {
    MAGNIFICATION_MONITOR.with(|monitor| {
        if monitor.borrow().is_some() {
            return;
        }

        let handler = RcBlock::new(move |event: NonNull<NSEvent>| {
            // The event came from AppKit and remains valid until the monitor
            // returns it. We only read its type and a scalar delta here.
            let event = unsafe { event.as_ref() };
            match event.r#type() {
                NSEventType::Magnify => {
                    let _ = app.emit("native-page-zoom-delta", event.magnification());
                }
                NSEventType::EndGesture => {
                    let _ = app.emit("native-page-zoom-end", ());
                }
                _ => {}
            }
            event as *const NSEvent as *mut NSEvent
        });
        let mask = NSEventMask::Magnify | NSEventMask::EndGesture;
        let token =
            unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &handler) };
        *monitor.borrow_mut() = token;
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn reader_page_zoom_range_matches_the_shared_preference_contract() {
        assert!((0.2..=5.0).contains(&1.0));
        assert!(!(0.2..=5.0).contains(&0.19));
        assert!(!(0.2..=5.0).contains(&5.01));
    }
}
