// Windows would otherwise open a console window beside the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    simplemark_lib::run()
}
