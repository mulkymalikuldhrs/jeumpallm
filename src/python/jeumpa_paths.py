import os, sys, platform, shutil, json, time
from pathlib import Path
from typing import Optional

PROJECT = "jeumpallm"

def _detect_home() -> Path:
    env_home = os.environ.get("JEUMAPPA_HOME")
    if env_home:
        return Path(env_home).resolve()

    script_dir = Path(__file__).parent.resolve()
    try:
        test = script_dir / ".jeumpa_root"
        test.touch(exist_ok=True)
        return script_dir
    except (OSError, PermissionError):
        pass

    for base in [
        Path.home() / f".{PROJECT}",
        Path.home() / ".local" / "share" / PROJECT,
    ]:
        try:
            base.mkdir(parents=True, exist_ok=True)
            return base
        except (OSError, PermissionError):
            continue

    fallback = Path(f"/tmp/{PROJECT}")
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def _detect_android_storage_roots() -> list[Path]:
    roots = []
    for p in ["/sdcard", "/storage/emulated/0", "/data/media/0",
              "/storage", "/mnt/sdcard", "/mnt/user/0/primary"]:
        pp = Path(p)
        if pp.exists():
            try:
                pp / ".write_test"
                roots.append(pp)
            except:
                pass
    return roots

def _detect_data_root() -> Path:
    env_data = os.environ.get("JEUMAPPA_DATA")
    if env_data:
        return Path(env_data).resolve()

    home = get_home()
    candidates = [home / "data", Path.home() / f".{PROJECT}" / "data"]

    if get_os() == "android":
        for root in _detect_android_storage_roots():
            for sub in ["dhaherlabs", PROJECT, f"dhaherlabs/{PROJECT}"]:
                candidates.append(root / sub / "data")

    for p in candidates:
        try:
            p.mkdir(parents=True, exist_ok=True)
            test = p / ".write_test"
            test.touch(exist_ok=True)
            test.unlink(missing_ok=True)
            return p
        except (OSError, PermissionError):
            continue

    fallback = Path(f"/tmp/{PROJECT}_data")
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def _detect_env_file() -> Optional[Path]:
    env_custom = os.environ.get("JEUMAPPA_ENV_FILE")
    if env_custom:
        p = Path(env_custom)
        if p.exists():
            return p

    candidates = [
        get_home() / ".env",
        Path.home() / ".env",
        Path.home() / f".{PROJECT}" / ".env",
        get_data_root() / ".env",
    ]

    for p in candidates:
        if p.exists():
            return p

    if get_os() == "android":
        for root in _detect_android_storage_roots():
            for p in [root / "dhaherlabs" / ".env", root / PROJECT / ".env"]:
                if p.exists():
                    return p
    return None


def _detect_config() -> Path:
    env_cfg = os.environ.get("JEUMAPPA_CONFIG")
    if env_cfg:
        return Path(env_cfg)

    candidates = [
        get_home() / "config.yaml",
        get_home() / "config.yml",
        get_data_root() / "config.yaml",
    ]
    for p in candidates:
        if p.exists():
            return p
    return get_home() / "config.yaml"


def _detect_log_dir() -> Path:
    env_log = os.environ.get("JEUMAPPA_LOG_DIR")
    if env_log:
        p = Path(env_log)
        p.mkdir(parents=True, exist_ok=True)
        return p
    p = get_data_root() / "logs"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _detect_backup_dir() -> Path:
    env_bk = os.environ.get("JEUMAPPA_BACKUP_DIR")
    if env_bk:
        p = Path(env_bk)
        p.mkdir(parents=True, exist_ok=True)
        return p
    p = get_data_root() / "backups"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _detect_pid_dir() -> Path:
    candidates = [
        get_data_root() / "run",
        Path("/tmp"),
    ]
    for p in candidates:
        try:
            p.mkdir(parents=True, exist_ok=True)
            return p
        except (OSError, PermissionError):
            continue
    return Path("/tmp")


def _detect_os() -> str:
    if shutil.which("termux-setup-storage") or os.environ.get("TERMUX_VERSION"):
        return "android"
    if "ANDROID_ROOT" in os.environ:
        return "android"
    uname = os.uname().sysname.lower()
    if uname == "linux":
        return "linux"
    if uname == "darwin":
        return "macos"
    return uname


def _detect_writable_dirs() -> list[Path]:
    dirs = [get_home(), get_data_root(), Path("/tmp")]

    if get_os() == "android":
        for root in _detect_android_storage_roots():
            try:
                test = root / ".write_test"
                test.touch(exist_ok=True)
                test.unlink(missing_ok=True)
                dirs.append(root)
            except:
                continue

    seen = set()
    result = []
    for d in dirs:
        if d and d.exists() and str(d) not in seen:
            seen.add(str(d))
            result.append(d)
    return result


_CACHE = {}

def _cached(key: str, func):
    if key not in _CACHE:
        _CACHE[key] = func()
    return _CACHE[key]

def get_home() -> Path:
    return _cached("home", _detect_home)

def get_data_root() -> Path:
    return _cached("data_root", _detect_data_root)

def get_env_file() -> Optional[Path]:
    return _cached("env_file", _detect_env_file)

def get_config() -> Path:
    return _cached("config", _detect_config)

def get_log_dir() -> Path:
    return _cached("log_dir", _detect_log_dir)

def get_backup_dir() -> Path:
    return _cached("backup_dir", _detect_backup_dir)

def get_pid_dir() -> Path:
    return _cached("pid_dir", _detect_pid_dir)

def get_os() -> str:
    return _cached("os", _detect_os)

def get_writable_dirs() -> list[Path]:
    return _cached("writable", _detect_writable_dirs)

def get_db_path(name: str = "jeumpa.db") -> Path:
    env_db = os.environ.get(f"JEUMAPPA_{name.upper().replace('.','_')}_DB")
    if env_db:
        return Path(env_db)
    return get_data_root() / name

def get_tunnel_config_path() -> Path:
    env_tunnel = os.environ.get("JEUMAPPA_TUNNEL_CONFIG")
    if env_tunnel:
        return Path(env_tunnel)
    return Path.home() / ".cloudflared" / "config.yaml"

def get_all_paths() -> dict:
    return {
        "home": str(get_home()),
        "data_root": str(get_data_root()),
        "env_file": str(get_env_file()) if get_env_file() else None,
        "config": str(get_config()),
        "log_dir": str(get_log_dir()),
        "backup_dir": str(get_backup_dir()),
        "pid_dir": str(get_pid_dir()),
        "db_path": str(get_db_path()),
        "rag_db_path": str(get_db_path("rag.db")),
        "os": get_os(),
        "writable_dirs": [str(d) for d in get_writable_dirs()],
        "tunnel_config": str(get_tunnel_config_path()),
        "python": sys.executable,
        "platform": sys.platform,
    }

def load_env_file() -> dict:
    env_file = get_env_file()
    if not env_file:
        return {}
    keys = {}
    try:
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip("'").strip('"')
                keys[k] = v
                os.environ.setdefault(k, v)
    except Exception as e:
        import logging
        logging.getLogger("jeumpa.paths").warning(f"Failed to load env file {env_file}: {e}")
    return keys

def clear_cache():
    _CACHE.clear()
