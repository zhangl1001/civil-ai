#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::process::{Child, Command};
use std::sync::Mutex;
struct Backend(Mutex<Option<Child>>);
fn main() {
    let backend = Backend(Mutex::new(None));
    if let Ok(mut guard) = backend.0.lock() {
        let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())).unwrap_or_else(|| ".".into());
        let res = exe_dir.join("../Resources");
        let py = res.join("py-env/python3");
        let lib = res.join("py-env/lib");
        let child = Command::new(&py).env("DYLD_LIBRARY_PATH", &lib)
            .args(["-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8765", "--log-level", "warning"])
            .current_dir(&res).spawn();
        match child { Ok(c) => { println!("Backend started (pid: {})", c.id()); *guard = Some(c); } Err(e) => eprintln!("Backend error: {}", e) }
    }
    tauri::Builder::default().plugin(tauri_plugin_shell::init()).manage(backend).run(tauri::generate_context!()).expect("error");
}
