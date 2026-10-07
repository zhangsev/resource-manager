//! OS helpers used by the Tauri commands.
//!
//! This module deliberately depends on `std` only, so it can be compiled and unit-tested
//! on its own: `rustc --edition 2021 --test src/helpers.rs -o /tmp/h && /tmp/h`

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub const DB_FILE: &str = "resmanager.db";

#[derive(Debug, Clone, PartialEq)]
pub struct AppPaths {
    /// folder that contains data/, backup/, exports/ (the exe folder in portable mode)
    pub base: PathBuf,
    pub data: PathBuf,
    pub db: PathBuf,
    pub backup: PathBuf,
    pub exports: PathBuf,
    pub tmp: PathBuf,
    /// false when the exe folder was not writable and we fell back to the user profile
    pub portable: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PathInfo {
    pub path: String,
    pub exists: bool,
    pub is_dir: bool,
    pub size: u64,
}

fn layout(base: PathBuf, portable: bool) -> AppPaths {
    let data = base.join("data");
    AppPaths {
        db: data.join(DB_FILE),
        tmp: data.join("tmp"),
        backup: base.join("backup"),
        exports: base.join("exports"),
        data,
        base,
        portable,
    }
}

fn ensure_dirs(p: &AppPaths) -> io::Result<()> {
    for d in [&p.data, &p.backup, &p.exports, &p.tmp] {
        fs::create_dir_all(d)?;
    }
    // probe that we can actually write (read-only USB stick, Program Files, ...)
    let probe = p.data.join(".write-test");
    fs::write(&probe, b"ok")?;
    let _ = fs::remove_file(&probe);
    Ok(())
}

/// Resolve where data lives.
/// Order: `RESMANAGER_HOME` env var -> folder of the executable -> per-user fallback.
pub fn resolve_paths(exe: Option<PathBuf>, env_home: Option<String>, user_fallback: Option<PathBuf>) -> io::Result<AppPaths> {
    if let Some(h) = env_home.filter(|s| !s.trim().is_empty()) {
        let p = layout(PathBuf::from(h), true);
        ensure_dirs(&p)?;
        return Ok(p);
    }
    if let Some(dir) = exe.as_ref().and_then(|e| e.parent().map(Path::to_path_buf)) {
        let p = layout(dir, true);
        if ensure_dirs(&p).is_ok() {
            return Ok(p);
        }
    }
    let fb = user_fallback.ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no writable data directory"))?;
    let p = layout(fb, false);
    ensure_dirs(&p)?;
    Ok(p)
}

pub fn app_paths() -> io::Result<AppPaths> {
    let exe = std::env::current_exe().ok();
    let env_home = std::env::var("RESMANAGER_HOME").ok();
    let fallback = std::env::var_os("APPDATA")
        .or_else(|| std::env::var_os("HOME"))
        .map(|p| PathBuf::from(p).join("ResManager"));
    resolve_paths(exe, env_home, fallback)
}

pub fn path_info(paths: &[String]) -> Vec<PathInfo> {
    paths
        .iter()
        .map(|p| match fs::metadata(p) {
            Ok(m) => PathInfo { path: p.clone(), exists: true, is_dir: m.is_dir(), size: if m.is_file() { m.len() } else { 0 } },
            Err(_) => PathInfo { path: p.clone(), exists: false, is_dir: false, size: 0 },
        })
        .collect()
}

fn check_no_newline(s: &str) -> io::Result<()> {
    if s.contains('\n') || s.contains('\r') || s.contains('\0') {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "路径或网址中包含非法字符"));
    }
    Ok(())
}

/// Open a file / folder with its default application.
pub fn open_path(path: &str) -> io::Result<()> {
    check_no_newline(path)?;
    if !Path::new(path).exists() {
        return Err(io::Error::new(io::ErrorKind::NotFound, format!("路径不存在：{path}")));
    }
    open_with_shell(path)
}

/// Open an http(s)/mailto/... URL in the default handler.
pub fn open_url(url: &str) -> io::Result<()> {
    check_no_newline(url)?;
    let lower = url.to_ascii_lowercase();
    let allowed = ["http://", "https://", "mailto:", "ftp://", "file://"];
    if !allowed.iter().any(|p| lower.starts_with(p)) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "只支持 http/https/mailto/ftp/file 链接"));
    }
    open_with_shell(url)
}

#[cfg(windows)]
fn open_with_shell(target: &str) -> io::Result<()> {
    // FileProtocolHandler receives the rest of the command line verbatim, so no quoting issues
    // with spaces, and no shell is involved (safe with & | ^ in URLs).
    Command::new("rundll32.exe")
        .raw_arg(format!("url.dll,FileProtocolHandler {target}"))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
}

#[cfg(not(windows))]
fn open_with_shell(target: &str) -> io::Result<()> {
    let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    Command::new(opener).arg(target).spawn().map(|_| ())
}

/// Show the file selected in Explorer (or open the folder).
pub fn reveal_path(path: &str) -> io::Result<()> {
    check_no_newline(path)?;
    let p = Path::new(path);
    if !p.exists() {
        return match p.parent().filter(|d| d.exists()) {
            Some(parent) => open_with_shell(&parent.to_string_lossy()),
            None => Err(io::Error::new(io::ErrorKind::NotFound, format!("路径不存在：{path}"))),
        };
    }
    reveal_existing(path)
}

#[cfg(windows)]
fn reveal_existing(path: &str) -> io::Result<()> {
    Command::new("explorer.exe").raw_arg(format!("/select,\"{path}\"")).spawn().map(|_| ())
}

#[cfg(not(windows))]
fn reveal_existing(path: &str) -> io::Result<()> {
    let p = Path::new(path);
    let dir = if p.is_dir() { p.to_path_buf() } else { p.parent().map(Path::to_path_buf).unwrap_or_else(|| p.to_path_buf()) };
    open_with_shell(&dir.to_string_lossy())
}

fn now_millis() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// Build the script text that will be executed in a new terminal window.
pub fn build_script(command: &str, shell: &str) -> (String, Vec<u8>) {
    let body = command.replace("\r\n", "\n");
    if shell == "powershell" {
        let mut text = String::from("[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\r\n");
        for line in body.lines() {
            text.push_str(line);
            text.push_str("\r\n");
        }
        // Windows PowerShell 5.1 needs a BOM to read the script as UTF-8
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(text.as_bytes());
        ("ps1".into(), bytes)
    } else {
        // chcp first (pure ASCII) so the following lines are parsed as UTF-8
        let mut text = String::from("@chcp 65001 >nul\r\n");
        for line in body.lines() {
            text.push_str(line);
            text.push_str("\r\n");
        }
        ("cmd".into(), text.into_bytes())
    }
}

/// Delete old generated scripts so tmp/ doesn't grow forever.
pub fn cleanup_tmp(dir: &Path, older_than: Duration) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let cutoff = SystemTime::now().checked_sub(older_than).unwrap_or(UNIX_EPOCH);
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !name.starts_with("run-") {
            continue;
        }
        if let Ok(m) = e.metadata() {
            if m.modified().map(|t| t < cutoff).unwrap_or(false) {
                let _ = fs::remove_file(e.path());
            }
        }
    }
}

/// Run `command` in a new, visible terminal window that stays open.
pub fn run_in_terminal(command: &str, shell: &str, tmp_dir: &Path) -> io::Result<()> {
    if command.trim().is_empty() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "命令为空"));
    }
    fs::create_dir_all(tmp_dir)?;
    cleanup_tmp(tmp_dir, Duration::from_secs(24 * 3600));
    let (ext, bytes) = build_script(command, shell);
    let script = tmp_dir.join(format!("run-{}.{}", now_millis(), ext));
    fs::write(&script, bytes)?;
    spawn_terminal(&script, shell)
}

#[cfg(windows)]
fn spawn_terminal(script: &Path, shell: &str) -> io::Result<()> {
    let s = script.to_string_lossy();
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    let inner = if shell == "powershell" {
        format!("powershell.exe -NoLogo -NoExit -ExecutionPolicy Bypass -File \"{s}\"")
    } else {
        format!("cmd.exe /k \"{s}\"")
    };
    let mut c = Command::new("cmd.exe");
    c.raw_arg(format!("/c start \"ResManager\" {inner}")).creation_flags(CREATE_NO_WINDOW);
    if let Some(h) = home.filter(|h| h.exists()) {
        c.current_dir(h);
    }
    c.spawn().map(|_| ())
}

#[cfg(not(windows))]
fn spawn_terminal(script: &Path, shell: &str) -> io::Result<()> {
    let s = script.to_string_lossy().to_string();
    let prog = if shell == "powershell" { "pwsh" } else { "sh" };
    Command::new("x-terminal-emulator").args(["-e", prog, &s]).spawn().map(|_| ())
}

pub fn write_text_file(path: &str, content: &str) -> io::Result<()> {
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    fs::write(p, content.as_bytes())
}

pub fn read_text_file(path: &str) -> io::Result<String> {
    let m = fs::metadata(path)?;
    if m.len() > 50 * 1024 * 1024 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "文件过大（超过 50MB）"));
    }
    let bytes = fs::read(path)?;
    let text = String::from_utf8(bytes).map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "文件不是 UTF-8 文本"))?;
    Ok(text.trim_start_matches('\u{feff}').to_string())
}

/// Keep the newest `keep` backups (resmanager-*.db, timestamped names sort chronologically).
pub fn prune_backups(dir: &Path, keep: usize) -> io::Result<usize> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let n = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            n.starts_with("resmanager-") && n.ends_with(".db")
        })
        .collect();
    files.sort();
    files.reverse();
    let mut removed = 0;
    for f in files.into_iter().skip(keep.max(1)) {
        if fs::remove_file(&f).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("resmgr-test-{}-{}", name, now_millis()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn resolves_next_to_exe() {
        let d = tmpdir("exe");
        let p = resolve_paths(Some(d.join("ResManager.exe")), None, None).unwrap();
        assert!(p.portable);
        assert_eq!(p.base, d);
        assert_eq!(p.db, d.join("data").join(DB_FILE));
        assert!(p.backup.is_dir() && p.exports.is_dir() && p.tmp.is_dir());
    }

    #[test]
    fn env_override_wins() {
        let d = tmpdir("env");
        let e = tmpdir("envhome");
        let p = resolve_paths(Some(d.join("x.exe")), Some(e.to_string_lossy().into()), None).unwrap();
        assert_eq!(p.base, e);
    }

    #[cfg(unix)]
    #[test]
    fn falls_back_when_exe_dir_not_writable() {
        use std::os::unix::fs::PermissionsExt;
        let ro = tmpdir("ro");
        fs::set_permissions(&ro, fs::Permissions::from_mode(0o555)).unwrap();
        let fb = tmpdir("fb");
        let r = resolve_paths(Some(ro.join("x.exe")), None, Some(fb.clone()));
        fs::set_permissions(&ro, fs::Permissions::from_mode(0o755)).unwrap();
        // root can write anywhere; only assert fallback when the probe really failed
        let p = r.unwrap();
        if !p.portable {
            assert_eq!(p.base, fb);
        }
    }

    #[test]
    fn path_info_reports_files_and_dirs() {
        let d = tmpdir("pi");
        let f = d.join("a.txt");
        fs::write(&f, b"hello").unwrap();
        let r = path_info(&[f.to_string_lossy().into(), d.to_string_lossy().into(), d.join("nope").to_string_lossy().into()]);
        assert!(r[0].exists && !r[0].is_dir && r[0].size == 5);
        assert!(r[1].exists && r[1].is_dir);
        assert!(!r[2].exists);
    }

    #[test]
    fn scripts_are_crlf_and_utf8() {
        let (ext, bytes) = build_script("echo 你好\ndir", "cmd");
        assert_eq!(ext, "cmd");
        let s = String::from_utf8(bytes).unwrap();
        assert_eq!(s, "@chcp 65001 >nul\r\necho 你好\r\ndir\r\n");
        let (ext, bytes) = build_script("Get-Date", "powershell");
        assert_eq!(ext, "ps1");
        assert_eq!(&bytes[..3], &[0xEF, 0xBB, 0xBF]);
    }

    #[test]
    fn url_scheme_is_checked() {
        assert!(open_url("javascript:alert(1)").is_err());
        assert!(open_url("https://a\nb").is_err());
        assert!(open_path("/definitely/not/here/xyz").is_err());
    }

    #[test]
    fn text_file_roundtrip_strips_bom() {
        let d = tmpdir("rw");
        let f = d.join("sub").join("x.json");
        write_text_file(&f.to_string_lossy(), "\u{feff}{\"a\":1}").unwrap();
        assert_eq!(read_text_file(&f.to_string_lossy()).unwrap(), "{\"a\":1}");
    }

    #[test]
    fn prune_keeps_newest() {
        let d = tmpdir("bk");
        for n in ["resmanager-20260101-000000.db", "resmanager-20260102-000000.db", "resmanager-20260103-000000.db", "other.db"] {
            fs::write(d.join(n), b"x").unwrap();
        }
        assert_eq!(prune_backups(&d, 2).unwrap(), 1);
        assert!(!d.join("resmanager-20260101-000000.db").exists());
        assert!(d.join("resmanager-20260103-000000.db").exists());
        assert!(d.join("other.db").exists());
    }

    #[test]
    fn cleanup_only_touches_run_scripts() {
        let d = tmpdir("clean");
        fs::write(d.join("run-1.cmd"), b"x").unwrap();
        fs::write(d.join("keep.txt"), b"x").unwrap();
        cleanup_tmp(&d, Duration::from_secs(0));
        std::thread::sleep(Duration::from_millis(10));
        cleanup_tmp(&d, Duration::from_millis(1));
        assert!(!d.join("run-1.cmd").exists());
        assert!(d.join("keep.txt").exists());
    }
}
