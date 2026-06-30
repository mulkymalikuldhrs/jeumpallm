import os, shutil, tempfile, asyncio, subprocess, json, logging, resource, signal
from pathlib import Path

log = logging.getLogger("jeumpa.sandbox")

SUPPORTED_LANGUAGES = {
    "python": "py",
    "sh": "sh",
    "bash": "sh",
    "js": "js",
    "javascript": "js",
}

MAX_OUTPUT_SIZE = 1_000_000

async def run_code(code: str, language: str = "python", timeout: int = 30, memory_mb: int = 256) -> dict:
    ext = SUPPORTED_LANGUAGES.get(language)
    if not ext:
        return {"error": f"unsupported language: {language}", "status": 400}
    tmpdir = None
    try:
        tmpdir = tempfile.mkdtemp(prefix="jeumpa_sandbox_")
        tmp_path = Path(tmpdir)
        filename = f"script.{ext}"
        script_path = tmp_path / filename
        script_path.write_text(code, encoding="utf-8")
        runner = _get_runner(language, str(script_path))
        if not runner:
            return {"error": f"no runner for language: {language}", "status": 400}
        proc = await asyncio.create_subprocess_shell(
            runner,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            cwd=tmpdir,
            preexec_fn=_limit_memory(memory_mb) if memory_mb else None,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            try:
                proc.kill()
                await proc.wait()
            except:
                pass
            return {
                "stdout": "",
                "stderr": "Execution timed out",
                "exit_code": -1,
                "language": language,
                "timeout": True
            }
        stdout_str = stdout.decode(errors="replace")
        stderr_str = stderr.decode(errors="replace")
        if len(stdout_str) > MAX_OUTPUT_SIZE:
            stdout_str = stdout_str[:MAX_OUTPUT_SIZE] + "\n...[truncated]"
        if len(stderr_str) > MAX_OUTPUT_SIZE:
            stderr_str = stderr_str[:MAX_OUTPUT_SIZE] + "\n...[truncated]"
        return {
            "stdout": stdout_str,
            "stderr": stderr_str,
            "exit_code": proc.returncode,
            "language": language,
        }
    except Exception as e:
        return {"error": str(e), "status": 500}
    finally:
        if tmpdir and Path(tmpdir).exists():
            try:
                shutil.rmtree(tmpdir, ignore_errors=True)
            except:
                pass

async def run_code_safe(code: str, language: str = "python", timeout: int = 30) -> dict:
    ext = SUPPORTED_LANGUAGES.get(language)
    if not ext:
        return {"error": f"unsupported language: {language}", "status": 400}
    tmpdir = None
    try:
        tmpdir = tempfile.mkdtemp(prefix="jeumpa_sandbox_safe_")
        tmp_path = Path(tmpdir)
        filename = f"script.{ext}"
        script_path = tmp_path / filename
        script_path.write_text(code, encoding="utf-8")
        runner = _get_runner_safe(language, str(script_path))
        if not runner:
            return {"error": f"no safe runner for language: {language}", "status": 400}
        clean_env = _safe_env()
        proc = await asyncio.create_subprocess_shell(
            runner,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            cwd=tmpdir,
            env=clean_env,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            try:
                proc.kill()
                await proc.wait()
            except:
                pass
            return {
                "stdout": "",
                "stderr": "Execution timed out",
                "exit_code": -1,
                "language": language,
                "timeout": True
            }
        stdout_str = stdout.decode(errors="replace")
        stderr_str = stderr.decode(errors="replace")
        if len(stdout_str) > MAX_OUTPUT_SIZE:
            stdout_str = stdout_str[:MAX_OUTPUT_SIZE] + "\n...[truncated]"
        if len(stderr_str) > MAX_OUTPUT_SIZE:
            stderr_str = stderr_str[:MAX_OUTPUT_SIZE] + "\n...[truncated]"
        return {
            "stdout": stdout_str,
            "stderr": stderr_str,
            "exit_code": proc.returncode,
            "language": language,
        }
    except Exception as e:
        return {"error": str(e), "status": 500}
    finally:
        if tmpdir and Path(tmpdir).exists():
            try:
                shutil.rmtree(tmpdir, ignore_errors=True)
            except:
                pass

def _get_runner(language: str, script_path: str) -> str:
    runners = {
        "python": f"python3 -u {script_path}",
        "sh": f"sh {script_path}",
        "bash": f"bash {script_path}",
        "js": f"node {script_path}",
        "javascript": f"node {script_path}",
    }
    return runners.get(language)

def _get_runner_safe(language: str, script_path: str) -> str:
    runners = {
        "python": f"python3 -I -u {script_path}",
        "sh": f"sh {script_path}",
        "bash": f"bash {script_path}",
        "js": f"node {script_path}",
        "javascript": f"node {script_path}",
    }
    return runners.get(language)

def _safe_env() -> dict:
    env = {
        "PATH": "/usr/bin",
        "PYTHONSAFEPATH": "1",
        "HOME": "/tmp",
        "TMPDIR": "/tmp",
    }
    dangerous = [
        "LD_PRELOAD", "LD_LIBRARY_PATH", "PYTHONPATH",
        "PYTHONSTARTUP", "PYTHONHOME", "BASH_ENV",
        "IFS", "SHELLOPTS",
    ]
    for key in dangerous:
        if key in os.environ:
            env[key] = ""
    return env

def _limit_memory(memory_mb: int):
    def _set_limits():
        try:
            bytes_limit = memory_mb * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (bytes_limit, bytes_limit))
            resource.setrlimit(resource.RLIMIT_DATA, (bytes_limit, bytes_limit))
            resource.setrlimit(resource.RLIMIT_STACK, (bytes_limit, bytes_limit))
        except:
            pass
    return _set_limits

async def list_sandbox_languages() -> dict:
    return {
        "object": "list",
        "data": [
            {
                "id": lang,
                "extension": ext,
                "runner": _get_runner(lang, f"script.{ext}")
            }
            for lang, ext in SUPPORTED_LANGUAGES.items()
        ]
    }
