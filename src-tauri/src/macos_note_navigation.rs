//! Delivers SimpleMark's note-navigation chord before WebKit can consume it.
//!
//! AppKit does not reliably dispatch Command-Option-arrow key equivalents from
//! a Tauri menu into a WKWebView. The menu remains the visible command surface,
//! but this monitor owns the physical chord and emits the same shared command
//! to the TypeScript composition root exactly once.

use std::{cell::RefCell, ptr::NonNull};

use block2::RcBlock;
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags};
use tauri::{AppHandle, Emitter};

const COMMAND_EVENT: &str = "native-note-navigation";

// macOS virtual key codes for the four physical arrow keys. These codes stay
// stable across keyboard layouts, unlike the arrow characters themselves.
const LEFT_ARROW: u16 = 123;
const RIGHT_ARROW: u16 = 124;
const DOWN_ARROW: u16 = 125;
const UP_ARROW: u16 = 126;

thread_local! {
    /// AppKit keeps the monitor alive through this opaque token. It must stay
    /// on the main thread, where AppKit event monitors are installed and run.
    static NOTE_NAVIGATION_MONITOR: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
}

/// Installs the application-lifetime monitor for the four note-navigation
/// commands. The TypeScript listener resolves the live composition at delivery
/// time, so a note remount cannot leave this native hook pointing at stale UI.
pub fn install(app: &AppHandle) {
    NOTE_NAVIGATION_MONITOR.with(|monitor| {
        if monitor.borrow().is_some() {
            return;
        }

        let app = app.clone();
        let handler = RcBlock::new(move |event: NonNull<NSEvent>| {
            // The event remains valid until this monitor returns it. We read
            // only its scalar fields and either pass it on unchanged or consume
            // it after emitting one shell command.
            let event = unsafe { event.as_ref() };
            let Some(command) = note_navigation_command(event.keyCode(), event.modifierFlags())
            else {
                return event as *const NSEvent as *mut NSEvent;
            };

            let _ = app.emit(COMMAND_EVENT, command);
            std::ptr::null_mut()
        });
        let token = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &handler)
        };
        *monitor.borrow_mut() = token;
    });
}

fn note_navigation_command(key_code: u16, modifiers: NSEventModifierFlags) -> Option<&'static str> {
    // Ignore any chord with Shift or Control. Caps Lock, Function, and Numeric
    // Pad are intentionally irrelevant to this four-key navigation surface.
    let navigation_modifiers = NSEventModifierFlags::Command
        | NSEventModifierFlags::Option
        | NSEventModifierFlags::Shift
        | NSEventModifierFlags::Control;
    let required = NSEventModifierFlags::Command | NSEventModifierFlags::Option;
    if (modifiers & navigation_modifiers) != required {
        return None;
    }

    match key_code {
        LEFT_ARROW => Some("historyBack"),
        RIGHT_ARROW => Some("historyForward"),
        UP_ARROW => Some("previousNote"),
        DOWN_ARROW => Some("nextNote"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_option_arrows_map_to_the_shared_navigation_commands() {
        let modifiers = NSEventModifierFlags::Command | NSEventModifierFlags::Option;
        assert_eq!(
            note_navigation_command(LEFT_ARROW, modifiers),
            Some("historyBack")
        );
        assert_eq!(
            note_navigation_command(RIGHT_ARROW, modifiers),
            Some("historyForward")
        );
        assert_eq!(
            note_navigation_command(UP_ARROW, modifiers),
            Some("previousNote")
        );
        assert_eq!(
            note_navigation_command(DOWN_ARROW, modifiers),
            Some("nextNote")
        );
    }

    #[test]
    fn navigation_ignores_other_modifier_chords_and_non_arrows() {
        let modifiers = NSEventModifierFlags::Command | NSEventModifierFlags::Option;
        assert_eq!(note_navigation_command(12, modifiers), None);
        assert_eq!(
            note_navigation_command(DOWN_ARROW, modifiers | NSEventModifierFlags::Shift),
            None
        );
        assert_eq!(
            note_navigation_command(DOWN_ARROW, modifiers | NSEventModifierFlags::Control),
            None
        );
    }
}
