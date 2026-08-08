//! Adds SimpleMark exports to WKWebView's own macOS context menu.
//!
//! WebKit owns this menu and keeps supplying Look Up, spelling, substitutions,
//! services, and future macOS additions. We observe that finished native menu
//! and insert one submenu; we never rebuild or replace the system surface.

use std::sync::{Mutex, OnceLock};

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSMenu, NSMenuDidBeginTrackingNotification, NSMenuItem, NSUserInterfaceItemIdentification,
};
use objc2_foundation::{
    NSNotification, NSNotificationCenter, NSObject, NSObjectProtocol, NSString,
};
use serde::Deserialize;
use tauri::{AppHandle, Emitter};

const COMMAND_EVENT: &str = "native-context-menu-command";
const COPY_AS_TITLE: &str = "Copy As";

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static SELECTION_SHAPE: OnceLock<Mutex<NativeContextMenuShape>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeContextMenuShape {
    pub in_table: bool,
    pub in_code: bool,
}

pub fn set_selection_shape(shape: NativeContextMenuShape) {
    if let Ok(mut current) = SELECTION_SHAPE
        .get_or_init(|| Mutex::new(NativeContextMenuShape::default()))
        .lock()
    {
        *current = shape;
    }
}

#[derive(Debug)]
struct CopyAsItemIvars {
    command: String,
}

define_class!(
    #[unsafe(super(NSMenuItem))]
    #[name = "SimpleMarkCopyAsMenuItem"]
    #[thread_kind = MainThreadOnly]
    #[ivars = CopyAsItemIvars]
    struct CopyAsItem;

    impl CopyAsItem {
        #[unsafe(method(simpleMarkCopyAs:))]
        fn perform(&self, _sender: Option<&AnyObject>) {
            if let Some(app) = APP_HANDLE.get() {
                let _ = app.emit(COMMAND_EVENT, self.ivars().command.as_str());
            }
        }
    }
);

impl CopyAsItem {
    fn new(mtm: MainThreadMarker, title: &str, command: &str) -> Retained<Self> {
        let title = NSString::from_str(title);
        let key = NSString::new();
        let this = mtm.alloc().set_ivars(CopyAsItemIvars {
            command: command.to_string(),
        });
        let item: Retained<Self> = unsafe {
            msg_send![super(this), initWithTitle: &*title, action: sel!(simpleMarkCopyAs:), keyEquivalent: &*key]
        };
        // The item itself owns the action and is retained by its menu.
        unsafe { item.setTarget(Some(&item)) };
        item
    }
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "SimpleMarkContextMenuObserver"]
    #[thread_kind = MainThreadOnly]
    #[ivars = ()]
    struct ContextMenuObserver;

    impl ContextMenuObserver {
        #[unsafe(method(simpleMarkMenuDidBeginTracking:))]
        fn menu_did_begin_tracking(&self, notification: &NSNotification) {
            let Some(object) = notification.object() else {
                return;
            };
            let Ok(menu) = object.downcast::<NSMenu>() else {
                return;
            };
            augment_context_menu(&menu, MainThreadMarker::from(self));
        }
    }

    unsafe impl NSObjectProtocol for ContextMenuObserver {}
);

impl ContextMenuObserver {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = mtm.alloc().set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

pub fn install(app: &AppHandle) -> Result<(), String> {
    let _ = APP_HANDLE.set(app.clone());
    let mtm = MainThreadMarker::new().ok_or_else(|| {
        "The native context menu must be installed on the main thread".to_string()
    })?;
    let observer = ContextMenuObserver::new(mtm);
    let center = NSNotificationCenter::defaultCenter();
    unsafe {
        center.addObserver_selector_name_object(
            &observer,
            sel!(simpleMarkMenuDidBeginTracking:),
            Some(NSMenuDidBeginTrackingNotification),
            None,
        );
    }
    // The observer is application-lifetime infrastructure. NotificationCenter
    // does not own selector observers, so keep this retain for the process.
    std::mem::forget(observer);
    Ok(())
}

fn augment_context_menu(menu: &NSMenu, mtm: MainThreadMarker) {
    // A submenu has a supermenu; the menu bar's Edit menu does too. The root
    // WebKit context menu is unattached and contains the ordinary copy action.
    if unsafe { menu.supermenu() }.is_some() {
        return;
    }

    let items = menu.itemArray();
    if items
        .iter()
        .any(|item| item.title().to_string() == COPY_AS_TITLE)
    {
        return;
    }
    let Some(copy_index) = items.iter().position(|item| is_webkit_copy_item(&item)) else {
        return;
    };

    let shape = SELECTION_SHAPE
        .get_or_init(|| Mutex::new(NativeContextMenuShape::default()))
        .lock()
        .map(|shape| *shape)
        .unwrap_or_default();
    let submenu = build_copy_as_menu(mtm, shape);
    let title = NSString::from_str(COPY_AS_TITLE);
    let key = NSString::new();
    let parent =
        unsafe { NSMenuItem::initWithTitle_action_keyEquivalent(mtm.alloc(), &title, None, &key) };
    parent.setSubmenu(Some(&submenu));
    menu.insertItem_atIndex(&parent, copy_index as isize + 1);
}

fn is_webkit_copy_item(item: &NSMenuItem) -> bool {
    item.identifier()
        .is_some_and(|identifier| identifier.to_string() == "WKMenuItemIdentifierCopy")
        || item.action() == Some(sel!(copy:))
}

fn build_copy_as_menu(mtm: MainThreadMarker, shape: NativeContextMenuShape) -> Retained<NSMenu> {
    let menu = NSMenu::initWithTitle(mtm.alloc(), &NSString::from_str(COPY_AS_TITLE));
    add_command(&menu, mtm, "Markdown", "copyAsMarkdown");
    add_command(&menu, mtm, "Plain Text", "copyAsPlainText");
    add_command(&menu, mtm, "Rich Text", "copyAsRichText");
    add_command(&menu, mtm, "HTML", "copyAsHtml");

    if shape.in_code {
        menu.addItem(&NSMenuItem::separatorItem(mtm));
        add_command(&menu, mtm, "Code", "copyCode");
    }

    if shape.in_table {
        menu.addItem(&NSMenuItem::separatorItem(mtm));
        let table_menu = NSMenu::initWithTitle(mtm.alloc(), &NSString::from_str("Table"));
        add_command(&table_menu, mtm, "Markdown", "copyTableAsMarkdown");
        add_command(&table_menu, mtm, "HTML", "copyTableAsHtml");
        add_command(&table_menu, mtm, "CSV", "copyTableAsCsv");
        let table_item = unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                mtm.alloc(),
                &NSString::from_str("Table"),
                None,
                &NSString::new(),
            )
        };
        table_item.setSubmenu(Some(&table_menu));
        menu.addItem(&table_item);
    }
    menu
}

fn add_command(menu: &NSMenu, mtm: MainThreadMarker, title: &str, command: &str) {
    let item = CopyAsItem::new(mtm, title, command);
    menu.addItem(&item);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_shape_deserializes_from_the_typescript_contract() {
        let shape: NativeContextMenuShape =
            serde_json::from_str(r#"{"inTable":true,"inCode":false}"#)
                .expect("shape should deserialize");
        assert_eq!(
            shape,
            NativeContextMenuShape {
                in_table: true,
                in_code: false,
            }
        );
    }
}
