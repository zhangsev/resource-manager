mod helpers;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

// ------------------------------------------------------------------ DTOs

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppPathsDto {
    base: String,
    data: String,
    db: String,
    backup: String,
    exports: String,
    tmp: String,
    portable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PathInfoDto {
    path: String,
    exists: bool,
    is_dir: bool,
    size: u64,
}

fn s(p: &std::path::Path) -> String {
    p.to_string_lossy().to_string()
}

fn err(e: std::io::Error) -> String {
    e.to_string()
}

// ------------------------------------------------------------------ commands

#[tauri::command]
fn app_paths() -> Result<AppPathsDto, String> {
    let p = helpers::app_paths().map_err(err)?;
    Ok(AppPathsDto {
        base: s(&p.base),
        data: s(&p.data),
        db: s(&p.db),
        backup: s(&p.backup),
        exports: s(&p.exports),
        tmp: s(&p.tmp),
        portable: p.portable,
    })
}

#[tauri::command]
fn path_info(paths: Vec<String>) -> Vec<PathInfoDto> {
    helpers::path_info(&paths)
        .into_iter()
        .map(|i| PathInfoDto { path: i.path, exists: i.exists, is_dir: i.is_dir, size: i.size })
        .collect()
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    helpers::open_path(&path).map_err(err)
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    helpers::reveal_path(&path).map_err(err)
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    helpers::open_url(&url).map_err(err)
}

#[tauri::command]
fn run_in_terminal(command: String, shell: String) -> Result<(), String> {
    let p = helpers::app_paths().map_err(err)?;
    helpers::run_in_terminal(&command, &shell, &p.tmp).map_err(err)
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    helpers::write_text_file(&path, &content).map_err(err)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    helpers::read_text_file(&path).map_err(err)
}

#[tauri::command]
fn prune_backups(dir: String, keep: usize) -> Result<usize, String> {
    helpers::prune_backups(std::path::Path::new(&dir), keep).map_err(err)
}

// ------------------------------------------------------------------ app

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        // must be registered first: a second launch just focuses the running instance
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            app_paths,
            path_info,
            open_path,
            reveal_path,
            open_url,
            run_in_terminal,
            write_text_file,
            read_text_file,
            prune_backups
        ])
        .setup(|app| {
            // fail early with a readable message if no data directory is writable
            helpers::app_paths().map_err(|e| format!("无法创建数据目录: {e}"))?;

            let open_i = MenuItem::with_id(app, "open", "打开主窗口", true, None::<&str>)?;
            let search_i = MenuItem::with_id(app, "search", "搜索", true, None::<&str>)?;
            let add_i = MenuItem::with_id(app, "add", "快速添加", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &search_i, &add_i, &quit_i])?;

            let mut tray = TrayIconBuilder::with_id("main-tray")
                .tooltip("ResManager")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "search" => {
                        if let Some(w) = app.get_webview_window("launcher") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = app.emit("resmanager://launcher-open", ());
                        }
                    }
                    // the main window's JS positions the quick-add bar (bottom-right) before showing it
                    "add" => {
                        let _ = app.emit("resmanager://tray-quickadd", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // closing any window only hides it; "退出" in the tray menu really quits
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running ResManager");
}
