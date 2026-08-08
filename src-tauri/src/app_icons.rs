#[cfg(target_os = "macos")]
use objc2::{AllocAnyThread, MainThreadMarker};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSApplication, NSImage};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSData, NSString, NSUserDefaults};

const PREFERENCE_KEY: &str = "app.simplemark.selected-app-icon";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AppIconId {
    Original,
    LiveLayers,
    MovableBlocks,
    BlueTrio,
    ElectricBlocks,
    Midnight,
    BluePage,
}

impl AppIconId {
    #[cfg(test)]
    pub(crate) const ALL: [Self; 7] = [
        Self::Original,
        Self::LiveLayers,
        Self::MovableBlocks,
        Self::BlueTrio,
        Self::ElectricBlocks,
        Self::Midnight,
        Self::BluePage,
    ];

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "original" => Some(Self::Original),
            "live-layers" => Some(Self::LiveLayers),
            "movable-blocks" => Some(Self::MovableBlocks),
            "blue-trio" => Some(Self::BlueTrio),
            "electric-blocks" => Some(Self::ElectricBlocks),
            "midnight" => Some(Self::Midnight),
            "blue-page" => Some(Self::BluePage),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Original => "original",
            Self::LiveLayers => "live-layers",
            Self::MovableBlocks => "movable-blocks",
            Self::BlueTrio => "blue-trio",
            Self::ElectricBlocks => "electric-blocks",
            Self::Midnight => "midnight",
            Self::BluePage => "blue-page",
        }
    }

    pub(crate) const fn png(self) -> &'static [u8] {
        match self {
            Self::Original => include_bytes!("../icons/alternates/png/original.png"),
            Self::LiveLayers => include_bytes!("../icons/alternates/png/live-layers.png"),
            Self::MovableBlocks => include_bytes!("../icons/alternates/png/movable-blocks.png"),
            Self::BlueTrio => include_bytes!("../icons/alternates/png/blue-trio.png"),
            Self::ElectricBlocks => include_bytes!("../icons/alternates/png/electric-blocks.png"),
            Self::Midnight => include_bytes!("../icons/alternates/png/midnight.png"),
            Self::BluePage => include_bytes!("../icons/alternates/png/blue-page.png"),
        }
    }
}

fn normalise_stored(value: Option<&str>) -> AppIconId {
    value
        .and_then(AppIconId::parse)
        .unwrap_or(AppIconId::Original)
}

#[cfg(target_os = "macos")]
fn stored() -> AppIconId {
    let defaults = NSUserDefaults::standardUserDefaults();
    let key = NSString::from_str(PREFERENCE_KEY);
    let value = defaults.stringForKey(&key);
    normalise_stored(value.as_ref().map(|value| value.to_string()).as_deref())
}

#[cfg(not(target_os = "macos"))]
fn stored() -> AppIconId {
    AppIconId::Original
}

#[cfg(target_os = "macos")]
fn apply(icon: AppIconId) -> Result<(), String> {
    let marker = MainThreadMarker::new()
        .ok_or_else(|| "The application icon must change on the macOS main thread".to_string())?;
    let data = NSData::with_bytes(icon.png());
    let image = NSImage::initWithData(NSImage::alloc(), &data)
        .ok_or_else(|| format!("Could not decode the {} app icon", icon.as_str()))?;
    let application = NSApplication::sharedApplication(marker);
    // SAFETY: `image` is a live NSImage created from a bundled PNG and AppKit
    // retains the application icon for the process lifetime.
    unsafe { application.setApplicationIconImage(Some(&image)) };
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn apply(_icon: AppIconId) -> Result<(), String> {
    Err("Alternate application icons are available only on macOS".to_string())
}

#[cfg(target_os = "macos")]
fn persist(icon: AppIconId) {
    let defaults = NSUserDefaults::standardUserDefaults();
    let key = NSString::from_str(PREFERENCE_KEY);
    let value = NSString::from_str(icon.as_str());
    // SAFETY: NSString is a valid property-list value for NSUserDefaults.
    unsafe { defaults.setObject_forKey(Some(&value), &key) };
}

#[tauri::command]
pub(crate) fn get_app_icon() -> String {
    stored().as_str().to_string()
}

#[tauri::command]
pub(crate) fn set_app_icon(icon: String) -> Result<(), String> {
    let icon =
        AppIconId::parse(&icon).ok_or_else(|| format!("Unknown application icon: {icon}"))?;
    apply(icon)?;
    #[cfg(target_os = "macos")]
    persist(icon);
    Ok(())
}

pub(crate) fn restore() -> Result<(), String> {
    apply(stored())
}

#[cfg(test)]
mod tests {
    use super::{normalise_stored, AppIconId};

    #[test]
    fn parses_only_known_icon_ids() {
        assert_eq!(AppIconId::parse("midnight"), Some(AppIconId::Midnight));
        assert_eq!(AppIconId::parse("blue-trio"), Some(AppIconId::BlueTrio));
        assert_eq!(
            AppIconId::parse("electric-blocks"),
            Some(AppIconId::ElectricBlocks)
        );
        assert_eq!(AppIconId::parse("unknown"), None);
    }

    #[test]
    fn every_icon_has_embedded_png_bytes() {
        for icon in AppIconId::ALL {
            assert!(icon.png().starts_with(b"\x89PNG\r\n\x1a\n"));
        }
    }

    #[test]
    fn invalid_stored_values_fall_back_to_original() {
        assert_eq!(normalise_stored(Some("live-layers")), AppIconId::LiveLayers);
        assert_eq!(normalise_stored(Some("retired-icon")), AppIconId::Original);
        assert_eq!(normalise_stored(None), AppIconId::Original);
    }
}
