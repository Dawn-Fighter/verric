// Verric desktop entry point — a thin Tauri wrapper around the Next.js
// studio. We don't add any custom commands here yet; the web UI talks
// to the same /api/* routes whether it's served from Docker or from
// this desktop bundle.
//
// Why a Tauri wrapper at all? Some users (small consultancies, lone
// pentesters) won't run a Docker server. A double-click installer that
// starts the Next.js process locally and shows it in a window is the
// shortest path from "I want to try it" to "first report".

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running Verric desktop");
}
