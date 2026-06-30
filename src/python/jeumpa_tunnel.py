import os, json, subprocess, asyncio, socket, logging, time
from typing import Optional
from pathlib import Path

log = logging.getLogger("jeumpa.tunnel")

class TunnelDetector:
    def __init__(self, port: int = 3456):
        self.port = port
        self._public_url: Optional[str] = None
        self._tunnel_type: Optional[str] = None
        self._tunnel_name: Optional[str] = None
        self._tunnel_pid: Optional[int] = None
        self._last_check: float = 0

    async def detect(self, force: bool = False) -> dict:
        if not force and self._last_check > 0:
            return self.get_status()

        url = os.environ.get("JEUMAPPA_PUBLIC_URL") or os.environ.get("PUBLIC_URL")

        if not url:
            pid = self._detect_tunnel_pid()
            if pid:
                self._tunnel_pid = pid
                url = await self._extract_url_from_running_tunnel(pid)

        if not url:
            url = await self._detect_cloudflare()

        if not url:
            url = await self._detect_ngrok()

        if not url:
            url = await self._detect_local_tunnel()

        if not url:
            url = self._detect_local_ip()

        if not url:
            url = await self.get_quick_tunnel()

        if url:
            self._public_url = url.rstrip("/")

        self._last_check = time.time()
        return self.get_status()

    async def _extract_url_from_running_tunnel(self, pid: int) -> Optional[str]:
        try:
            cmdline = Path(f"/proc/{pid}/cmdline")
            if cmdline.exists():
                cmd = cmdline.read_text().replace("\0", " ").strip()
                for chunk in cmd.split():
                    if chunk.startswith("http://") or chunk.startswith("https://"):
                        self._tunnel_type = "cloudflare"
                        self._tunnel_name = f"pid:{pid}"
                        return chunk
        except:
            pass

        try:
            log_dir = Path("/tmp")
            for f in log_dir.glob("cloudflared*.log"):
                text = f.read_text()
                for line in text.splitlines():
                    if "url" in line.lower() and ("http" in line):
                        for word in line.split():
                            if word.startswith("https://") or word.startswith("http://"):
                                self._tunnel_type = "cloudflare"
                                self._tunnel_name = f"log:{f.name}"
                                return word
        except:
            pass

        try:
            for p in ["cloudflared.log", ".cloudflared/cloudflared.log"]:
                logfile = Path.home() / p
                if logfile.exists():
                    text = logfile.read_text()
                    for line in text.splitlines():
                        if "url" in line.lower() and "http" in line:
                            for word in line.split():
                                if word.startswith("https://") or word.startswith("http://"):
                                    self._tunnel_type = "cloudflare"
                                    self._tunnel_name = f"log:{logfile.name}"
                                    return word
        except:
            pass
        return None

    async def _detect_ngrok(self) -> Optional[str]:
        try:
            async with aiohttp.ClientSession() as sess:
                async with sess.get("http://127.0.0.1:4040/api/tunnels", timeout=3) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for t in data.get("tunnels", []):
                            pub = t.get("public_url")
                            if pub:
                                self._tunnel_type = "ngrok"
                                self._tunnel_name = t.get("name", "ngrok")
                                return pub
        except ImportError:
            pass
        except:
            pass

        try:
            proc = await asyncio.create_subprocess_exec(
                "ngrok", "status",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
                for line in stdout.decode().splitlines():
                    if "url" in line.lower() and "forwarding" in line.lower():
                        for word in line.split():
                            if word.startswith("https://") and "ngrok" in word:
                                self._tunnel_type = "ngrok"
                                return word
            except asyncio.TimeoutError:
                proc.kill()
        except FileNotFoundError:
            pass
        except:
            pass
        return None

    async def _detect_cloudflare(self) -> Optional[str]:
        try:
            proc = await asyncio.create_subprocess_exec(
                "cloudflared", "tunnel", "info", "--output", "json",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)

            data = json.loads(stdout)
            tunnels = data if isinstance(data, list) else [data]
            for t in tunnels:
                name = t.get("name") or t.get("id", "")
                url = None
                if "cname" in t:
                    url = f"https://{t['cname']}"
                for conn in t.get("connections", []):
                    if "origin_url" in conn:
                        url = conn["origin_url"]
                if url:
                    self._tunnel_type = "cloudflare"
                    self._tunnel_name = name
                    return url
        except FileNotFoundError:
            pass
        except (asyncio.TimeoutError, json.JSONDecodeError, subprocess.CalledProcessError):
            pass
        except Exception as e:
            log.debug(f"cloudflared info failed: {e}")

        try:
            proc = await asyncio.create_subprocess_exec(
                "cloudflared", "tunnel", "list",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            for line in stdout.decode().splitlines():
                if "jeumpa" in line.lower() or "dhaher" in line.lower():
                    parts = line.split()
                    if parts:
                        self._tunnel_name = parts[0]
                        break
        except:
            pass

        return None

    async def _detect_local_tunnel(self) -> Optional[str]:
        try:
            proc = await asyncio.create_subprocess_exec(
                "lt", "--port", str(self.port), "--print-requests",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                line = await asyncio.wait_for(proc.stdout.readline(), timeout=5)
                text = line.decode().strip()
                if "url" in text.lower():
                    for word in text.split():
                        if word.startswith("http"):
                            self._tunnel_type = "localtunnel"
                            return word
            except asyncio.TimeoutError:
                proc.kill()
        except FileNotFoundError:
            pass
        except Exception as e:
            log.debug(f"localtunnel failed: {e}")
        return None

    def _detect_local_ip(self) -> Optional[str]:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            if ip:
                self._tunnel_type = "local"
                return f"http://{ip}:{self.port}"
        except Exception:
            pass
        try:
            hostname = socket.gethostname()
            ip = socket.gethostbyname(hostname)
            if ip and not ip.startswith("127."):
                self._tunnel_type = "local"
                return f"http://{ip}:{self.port}"
        except Exception:
            pass
        return None

    def _detect_tunnel_pid(self) -> Optional[int]:
        try:
            import subprocess
            r = subprocess.run(
                ["pgrep", "-f", "cloudflared"],
                capture_output=True, text=True, timeout=5,
            )
            if r.stdout.strip():
                pids = r.stdout.strip().splitlines()
                for pid in pids:
                    try:
                        ppid = int(pid)
                        cmdline = Path(f"/proc/{ppid}/cmdline")
                        if cmdline.exists():
                            cmd = cmdline.read_text().replace("\0", " ")
                            if "tunnel" in cmd and ("run" in cmd or "tunnel" in cmd):
                                return ppid
                    except: pass
        except: pass
        return None

    def build_api_url(self, path: str = "") -> str:
        base = self._public_url or f"http://localhost:{self.port}"
        base = base.rstrip("/")
        if not path:
            return base
        path = path.lstrip("/")
        return f"{base}/{path}"

    def get_status(self) -> dict:
        return {
            "public_url": self._public_url,
            "tunnel_type": self._tunnel_type,
            "tunnel_name": self._tunnel_name,
            "port": self.port,
            "api_base": self.build_api_url("v1"),
            "chat_url": self.build_api_url("v1/chat/completions"),
            "health_url": self.build_api_url("v1/health"),
            "models_url": self.build_api_url("v1/models"),
        }

    async def get_quick_tunnel(self) -> Optional[str]:
        env_url = os.environ.get("JEUMAPPA_PUBLIC_URL")
        if env_url:
            self._public_url = env_url
            self._tunnel_type = "env"
            return env_url

        try:
            proc = await asyncio.create_subprocess_exec(
                "cloudflared", "tunnel", "--url", f"http://localhost:{self.port}",
                "--output", "json",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                line = await asyncio.wait_for(proc.stdout.readline(), timeout=15)
                data = json.loads(line.decode().strip())
                url = data.get("url")
                if url:
                    self._public_url = url
                    self._tunnel_type = "cloudflare_quick"
                    return url
            except (asyncio.TimeoutError, json.JSONDecodeError):
                proc.kill()
        except FileNotFoundError:
            pass
        except Exception as e:
            log.debug(f"quick tunnel failed: {e}")
        return None
