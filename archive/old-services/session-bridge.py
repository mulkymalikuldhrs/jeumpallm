#!/usr/bin/env python3
"""
Dhaher Labs — Hermes ↔ OpenCode Session Bridge
Bidirectional session sync · Shared Memory · Unified Todo
Always synced, always available to both.
"""

import json
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime

WORKSPACE = "/sdcard/dhaherlabs"
LOG_FILE = f"{WORKSPACE}/logs/session-bridge.log"
STATE_FILE = f"{WORKSPACE}/data/session-bridge-state.json"

OPENCODE_DB = os.path.expanduser("/root/.local/share/opencode/opencode.db")
HERMES_DB = os.path.expanduser("/root/.hermes/state.db")
MEMORY_FILE = os.path.expanduser("/root/.hermes/MEMORY.md")
USER_FILE = os.path.expanduser("/root/.hermes/USER.md")
SHARED_MEMORY = f"{WORKSPACE}/data/shared-memory.md"
SHARED_TASKS = f"{WORKSPACE}/data/shared-tasks.json"

for d in [f"{WORKSPACE}/logs", f"{WORKSPACE}/data"]:
    os.makedirs(d, exist_ok=True)


def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(LOG_FILE, "a") as f:
        f.write(f"[{ts}] {msg}\n")


def get_opencode_sessions():
    """Get all sessions from opencode DB"""
    try:
        conn = sqlite3.connect(OPENCODE_DB)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("""
            SELECT s.*, GROUP_CONCAT(sm.data, '|||') as messages_json
            FROM session s
            LEFT JOIN session_message sm ON sm.session_id = s.id
            GROUP BY s.id
            ORDER BY s.time_created DESC
            LIMIT 20
        """)
        sessions = []
        for row in c.fetchall():
            sessions.append(dict(row))
        conn.close()
        return sessions
    except Exception as e:
        log(f"Error reading opencode DB: {e}")
        return []


def get_hermes_sessions():
    """Get all sessions from Hermes DB"""
    try:
        conn = sqlite3.connect(HERMES_DB)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("""
            SELECT s.*, GROUP_CONCAT(m.role || '::' || COALESCE(m.content,''), '|||') as messages_text
            FROM sessions s
            LEFT JOIN messages m ON m.session_id = s.id
            GROUP BY s.id
            ORDER BY s.started_at DESC
            LIMIT 20
        """)
        sessions = []
        for row in c.fetchall():
            sessions.append(dict(row))
        conn.close()
        return sessions
    except Exception as e:
        log(f"Error reading Hermes DB: {e}")
        return []


def sync_hermes_to_opencode():
    """Export Hermes sessions into opencode DB format"""
    hermes_sessions = get_hermes_sessions()
    if not hermes_sessions:
        return

    log(f"Syncing {len(hermes_sessions)} Hermes sessions → opencode")

    try:
        conn = sqlite3.connect(OPENCODE_DB)
        c = conn.cursor()

        for hs in hermes_sessions:
            hermes_id = hs["id"]
            oc_id = f"hermes_{hermes_id}"

            # Check if already imported
            c.execute("SELECT id FROM session WHERE id = ?", (oc_id,))
            if c.fetchone():
                continue

            # Create session entry
            c.execute("""
                INSERT OR IGNORE INTO session
                (id, project_id, workspace_id, slug, directory, path, title, version,
                 model, tokens_input, tokens_output, tokens_reasoning,
                 tokens_cache_read, tokens_cache_write, cost,
                 time_created, time_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                oc_id,
                "hermes-bridge",
                str(WORKSPACE),
                f"hermes-{hermes_id}",
                str(WORKSPACE),
                str(WORKSPACE),
                hs.get("title") or f"Hermes Session {hermes_id[:12]}",
                "1",
                hs.get("model", "unknown"),
                hs.get("input_tokens", 0) or 0,
                hs.get("output_tokens", 0) or 0,
                hs.get("reasoning_tokens", 0) or 0,
                hs.get("cache_read_tokens", 0) or 0,
                hs.get("cache_write_tokens", 0) or 0,
                hs.get("estimated_cost_usd", 0) or 0,
                int((hs.get("started_at", time.time()) or time.time()) * 1000),
                int(time.time() * 1000),
            ))

            # Import messages
            if hs.get("messages_text"):
                msgs = hs["messages_text"].split("|||")
                for i, msg_text in enumerate(msgs):
                    if "::" in msg_text:
                        role, content = msg_text.split("::", 1)
                        c.execute("""
                            INSERT OR IGNORE INTO session_message
                            (id, session_id, type, seq, time_created, time_updated, data)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, (
                            f"{oc_id}_msg_{i}",
                            oc_id,
                            role,
                            i,
                            int(time.time() * 1000),
                            int(time.time() * 1000),
                            json.dumps({"role": role, "content": content[:1000]}),
                        ))

        conn.commit()
        conn.close()
        log(f"✓ Synced {len(hermes_sessions)} sessions to opencode")
    except Exception as e:
        log(f"Error syncing to opencode: {e}")


def sync_opencode_to_hermes():
    """Export opencode sessions into Hermes DB format"""
    oc_sessions = get_opencode_sessions()
    if not oc_sessions:
        return

    log(f"Syncing {len(oc_sessions)} opencode sessions → Hermes")

    try:
        conn = sqlite3.connect(HERMES_DB)
        c = conn.cursor()

        for oc in oc_sessions:
            oc_id = oc["id"]
            hermes_id = f"oc_{oc_id}"

            # Check if already imported
            c.execute("SELECT id FROM sessions WHERE id = ?", (hermes_id,))
            if c.fetchone():
                continue

            messages_text = []
            if oc.get("messages_json"):
                parts = oc["messages_json"].split("|||")
                for p in parts[:10]:
                    try:
                        data = json.loads(p)
                        role = data.get("role", "user")
                        content = data.get("content", "")[:2000]
                        messages_text.append(f"{role}:::{content}")
                    except:
                        pass

            c.execute("""
                INSERT OR IGNORE INTO sessions
                (id, source, model, system_prompt, started_at, ended_at,
                 message_count, input_tokens, output_tokens,
                 cwd, title)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                hermes_id,
                "opencode",
                oc.get("model", "unknown"),
                "Imported from opencode",
                (oc.get("time_created", 0) or 0) / 1000,
                (oc.get("time_updated", 0) or 0) / 1000,
                len(messages_text),
                oc.get("tokens_input", 0) or 0,
                oc.get("tokens_output", 0) or 0,
                oc.get("directory", "/root"),
                oc.get("title", f"OpenCode Session {oc_id[:12]}"),
            ))

            # Import messages
            for i, msg in enumerate(messages_text):
                if ":::" in msg:
                    role, content = msg.split(":::", 1)
                    c.execute("""
                        INSERT INTO messages (session_id, role, content, timestamp, active)
                        VALUES (?, ?, ?, ?, 1)
                    """, (hermes_id, role, content, time.time()))

        conn.commit()
        conn.close()
        log(f"✓ Synced {len(oc_sessions)} sessions to Hermes")
    except Exception as e:
        log(f"Error syncing to Hermes: {e}")


# ─── Shared Memory ──────────────────────────────────────────────

def sync_memory():
    """Keep MEMORY.md, USER.md, and shared-memory.md in sync"""

    # Collect all memory sources
    memories = {}

    # From Hermes MEMORY.md
    if os.path.exists(MEMORY_FILE):
        with open(MEMORY_FILE) as f:
            memories["hermes"] = f.read()

    # From opencode sessions (extract facts)
    oc_sessions = get_opencode_sessions()
    oc_facts = []
    for s in oc_sessions[:5]:
        if s.get("messages_json"):
            for part in s["messages_json"].split("|||")[:20]:
                try:
                    data = json.loads(part)
                    if data.get("role") == "assistant":
                        content = data.get("content", "")
                        # Extract memory-worthy lines
                        for line in content.split("\n"):
                            if any(k in line.lower() for k in
                                   ["remember", "save", "note:", "fact:", "user ",
                                    "prefers", "uses", "workspace", "project"]):
                                oc_facts.append(line[:500])
                except:
                    pass

    # Build unified memory
    unified = []
    unified.append("# Dhaher Labs — Unified Memory (Shared by Hermes & OpenCode)")
    unified.append(f"# Last updated: {datetime.now().isoformat()}")
    unified.append("")

    if memories.get("hermes"):
        unified.append("## From Hermes")
        unified.append(memories["hermes"])
        unified.append("")

    if oc_facts:
        unified.append("## From OpenCode")
        for f in oc_facts:
            unified.append(f"- {f}")
        unified.append("")

    unified.append("## System State")
    unified.append(f"- Workspace: {WORKSPACE}")
    unified.append(f"- Platform: Android/Termux/Proot-Alpine")
    unified.append(f"- User: Mulky Malikul Dhaher (MulkyOS)")
    unified.append(f"- Organization: Dhaher Labs")
    unified.append("")

    content = "\n".join(unified)

    # Write to all locations
    with open(SHARED_MEMORY, "w") as f:
        f.write(content)

    # Also write to Hermes memory files if they don't exist
    if not os.path.exists(MEMORY_FILE):
        with open(MEMORY_FILE, "w") as f:
            f.write(content)

    log("✓ Shared memory synced")


def sync_tasks():
    """Unify todo lists between opencode and Hermes"""
    tasks = []

    # Get opencode todos
    try:
        conn = sqlite3.connect(OPENCODE_DB)
        c = conn.cursor()
        c.execute("SELECT * FROM todo ORDER BY time_created DESC LIMIT 50")
        for row in c.fetchall():
            tasks.append({
                "source": "opencode",
                "content": row[1],
                "status": row[2],
                "priority": row[3],
            })
        conn.close()
    except Exception as e:
        log(f"Error reading opencode todos: {e}")

    # Add manual tasks from workspace
    for task_file in [f"{WORKSPACE}/data/notebook.md", f"{WORKSPACE}/data/wishlist.md"]:
        if os.path.exists(task_file):
            with open(task_file) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("- [ ]") or line.startswith("* [ ]"):
                        tasks.append({
                            "source": task_file,
                            "content": line.replace("- [ ]", "").replace("* [ ]", "").strip(),
                            "status": "pending",
                            "priority": "medium",
                        })

    # Write shared task list
    with open(SHARED_TASKS, "w") as f:
        json.dump(tasks, f, indent=2)

    log(f"✓ {len(tasks)} shared tasks synced")


# ─── Export Unified Session ─────────────────────────────────────

def export_unified_session(output_path=None):
    """Export both Hermes and OpenCode sessions to a single unified file"""
    if not output_path:
        output_path = f"{WORKSPACE}/logs/session-unified-export.json"

    log(f"Exporting unified session to {output_path}")

    result = {
        "exported_at": datetime.now().isoformat(),
        "workspace": WORKSPACE,
        "hermes_sessions": get_hermes_sessions(),
        "opencode_sessions": get_opencode_sessions(),
        "memory": open(SHARED_MEMORY).read() if os.path.exists(SHARED_MEMORY) else "",
        "tasks": json.load(open(SHARED_TASKS)) if os.path.exists(SHARED_TASKS) else [],
    }

    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)

    log(f"✓ Unified session exported ({len(result['hermes_sessions'])} hermes + {len(result['opencode_sessions'])} opencode)")
    return output_path


# ─── Daemon ─────────────────────────────────────────────────────

def daemon():
    log("═══ Session Bridge Daemon Started ═══")
    log("Syncing Hermes ↔ OpenCode sessions bidirectionally")

    while True:
        try:
            # Sync both directions
            sync_hermes_to_opencode()
            sync_opencode_to_hermes()

            # Sync memory
            sync_memory()

            # Sync tasks
            sync_tasks()

            # Export unified session
            export_unified_session()

            log("Sync cycle complete. Next in 120s")
            time.sleep(120)

        except KeyboardInterrupt:
            log("Session bridge stopped by user")
            break
        except Exception as e:
            log(f"Sync error: {e}")
            time.sleep(30)


# ─── CLI ────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Dhaher Labs — Session Bridge")
        print("")
        print("Commands:")
        print("  daemon          Start continuous sync daemon")
        print("  sync            Run one sync cycle")
        print("  export [path]   Export unified session to JSON")
        print("  status          Show sync status")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "daemon":
        daemon()
    elif cmd == "sync":
        sync_hermes_to_opencode()
        sync_opencode_to_hermes()
        sync_memory()
        sync_tasks()
        export_unified_session()
        print("✓ Full sync complete")
    elif cmd == "export":
        path = sys.argv[2] if len(sys.argv) > 2 else None
        export_unified_session(path)
        print(f"✓ Exported to {path or f'{WORKSPACE}/logs/session-unified-export.json'}")
    elif cmd == "status":
        hermes_count = len(get_hermes_sessions())
        oc_count = len(get_opencode_sessions())
        print(f"Hermes sessions: {hermes_count}")
        print(f"OpenCode sessions: {oc_count}")
        print(f"Shared memory: {'EXISTS' if os.path.exists(SHARED_MEMORY) else 'NONE'}")
        print(f"Shared tasks: {len(json.load(open(SHARED_TASKS))) if os.path.exists(SHARED_TASKS) else 0}")
    else:
        print(f"Unknown: {cmd}")
