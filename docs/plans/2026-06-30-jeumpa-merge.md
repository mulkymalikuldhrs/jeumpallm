# JeumpaLLM Consolidation Merge — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use godmode:task-runner to implement this plan task-by-task.

**Goal:** Consolidate 4 variant repos (GitLab Python v2.0, Codeberg Python v2.0, GitHub Python v2.0, GitHub Node.js v1.0) into 1 canonical repo with no duplicates, cleaned archive, and preserved git history.

**Architecture:** GitLab variant (`JeumpaLLM-from-gitlab/`) is canonical — Python v2.0 with full git history. The 2 other Python variants (Codeberg, GitHub) are byte-identical to it (only .git differs). The Node.js v1.0 variant is a different stack entirely (Express, not aiohttp) and is superseded. Merge = delete duplicates + clean archive + keep Node.js as reference + move canonical to top level.

**Tech Stack:** Python 3 (aiohttp + pyyaml, no requirements.txt), Node.js v18+ (Express 5, reference only), SQLite

**Verification:** Manual diff checks after each delete step. `./start.sh` parse test after cleanup.

---

## Task 1: Delete Duplicate Codeberg Python Variant

**Files:**
- Delete: `JeumpaLLM-feom-codeberg/` (entire directory)
- Verify: `JeumpaLLM-from-gitlab/` untouched

**Step 1: Confirm byte-identity (already verified — only .git differs)**

Run:
```bash
diff -rq --exclude=.git --exclude=__pycache__ \
  JeumpaLLM-from-gitlab/ JeumpaLLM-feom-codeberg/ 2>/dev/null | grep -v 'git-repo'
```
Expected: no output (identical files)

**Step 2: Delete the duplicate**

Run:
```bash
rm -rf JeumpaLLM-feom-codeberg/
```

**Step 3: Verify deletion**

Run:
```bash
ls -d JeumpaLLM-feom-codeberg/ 2>&1
```
Expected: `ls: cannot access 'JeumpaLLM-feom-codeberg/': No such file or directory`

**Step 4: Verify canonical still intact**

Run:
```bash
ls JeumpaLLM-from-gitlab/jeumpa.py
```
Expected: `JeumpaLLM-from-gitlab/jeumpa.py`

**Step 5: Commit**

```bash
git add -A && git commit -m "delete: JeumpaLLM-feom-codeberg/ (byte-identical to GitLab variant)"
```

---

## Task 2: Delete Duplicate GitHub Python Variant

**Files:**
- Delete: `JeumpaLLM-from-github/` (entire directory)
- Delete: `JeumpaLLM-mainfromgithub.zip` (raw zip, no longer needed)

**Step 1: Confirm structure**

Run:
```bash
ls JeumpaLLM-from-github/JeumpaLLM-main/jeumpa.py
```
Expected: file exists (it's the same as GitLab, nested under `JeumpaLLM-main/`)

**Step 2: Delete duplicate + zip**

Run:
```bash
rm -rf JeumpaLLM-from-github/ JeumpaLLM-mainfromgithub.zip
```

**Step 3: Verify**

Run:
```bash
ls -d JeumpaLLM-from-github/ 2>&1
```
Expected: `No such file or directory`

**Step 4: Commit**

```bash
git add -A && git commit -m "delete: JeumpaLLM-from-github/ (byte-identical to GitLab variant)"
```

---

## Task 3: Clean archive/ in Canonical — Remove Bare Git Repo

**Files:**
- Delete: `JeumpaLLM-from-gitlab/archive/proxygatellm/git-repo/` (entire directory)
- Keep: `JeumpaLLM-from-gitlab/archive/proxygatellm/source/` (reference)

**Step 1: Measure space used**

Run:
```bash
du -sh JeumpaLLM-from-gitlab/archive/proxygatellm/git-repo/
```
Expected: ~2.4M

**Step 2: Delete bare git repo**

Run:
```bash
rm -rf JeumpaLLM-from-gitlab/archive/proxygatellm/git-repo/
```

**Step 3: Verify source reference still intact**

Run:
```bash
ls JeumpaLLM-from-gitlab/archive/proxygatellm/source/index.js
```
Expected: file exists (the actual Node.js source code, not git metadata)

**Step 4: Commit**

```bash
git add -A && git commit -m "delete: proxygatellm bare git repo (2.4MB of git objects, keep source/ for reference)"
```

---

## Task 4: Clean archive/ — Remove Old Service Scripts

**Files:**
- Delete: `JeumpaLLM-from-gitlab/archive/old-services/` (entire directory)
  - `jeumpallm.sh`
  - `model-router.py`
  - `session-bridge.py`
  - `tunnel.sh`

**Step 1: Verify old-services content**

Run:
```bash
ls JeumpaLLM-from-gitlab/archive/old-services/
```
Expected: 4 files listed above

**Step 2: Delete**

Run:
```bash
rm -rf JeumpaLLM-from-gitlab/archive/old-services/
```

**Step 3: Verify superseded by current start.sh**

Run:
```bash
grep -c 'start\|stop\|status\|logs\|backup' JeumpaLLM-from-gitlab/start.sh
```
Expected: ≥ 10 matches (current start.sh has all commands covered)

**Step 4: Commit**

```bash
git add -A && git commit -m "delete: archive/old-services/ (superseded by start.sh)"
```

---

## Task 5: Clean archive/ — Remove Old HTML Docs

**Files:**
- Delete: `JeumpaLLM-from-gitlab/archive/old-docs/` (entire directory)

**Step 1: Verify content**

Run:
```bash
ls JeumpaLLM-from-gitlab/archive/old-docs/
```
Expected: 6 files (mixed .md and .html)

**Step 2: Delete**

Run:
```bash
rm -rf JeumpaLLM-from-gitlab/archive/old-docs/
```

**Step 3: Commit**

```bash
git add -A && git commit -m "delete: archive/old-docs/ (HTML docs superseded by markdown)"
```

---

## Task 6: Remove Empty/Filler Files in Canonical

**Files:**
- Delete: `JeumpaLLM-from-gitlab/scripts/__init__.py` (empty, 0 bytes)
- Keep: `JeumpaLLM-from-gitlab/scripts/backup.sh` (actual utility)
- Delete: `JeumpaLLM-from-gitlab/docs/plans/2026-06-29-ui-ux-upgrade.md` (planning artifact)

**Step 1: Check files**

Run:
```bash
wc -l JeumpaLLM-from-gitlab/scripts/__init__.py
```
Expected: 0

Run:
```bash
head -3 JeumpaLLM-from-gitlab/docs/plans/2026-06-29-ui-ux-upgrade.md
```
Expected: planning document header

**Step 2: Delete**

Run:
```bash
rm JeumpaLLM-from-gitlab/scripts/__init__.py
rm JeumpaLLM-from-gitlab/docs/plans/2026-06-29-ui-ux-upgrade.md
```

**Step 3: Verify backup.sh still exists**

Run:
```bash
ls JeumpaLLM-from-gitlab/scripts/backup.sh
```
Expected: file exists

**Step 4: Commit**

```bash
git add -A && git commit -m "delete: empty __init__.py and stale planning doc"
```

---

## Task 7: Move Canonical Repo to Workspace Root

**Background:** Currently the canonical repo lives at `JeumpaLLM-from-gitlab/`. After deleting duplicates, we promote it to the root.

**Files:**
- Move: everything from `JeumpaLLM-from-gitlab/` up one level to `./`
- Delete: now-empty `JeumpaLLM-from-gitlab/` directory

**Step 1: Verify canonical is the only remaining variant dir**

Run:
```bash
ls -d */ 2>/dev/null
```
Expected: `JeumpaLLM-from-gitlab/` and `Jeumpa-LLM-from-github/` (and possibly `docs/`)

**Step 2: Rsync canonical content up one level (preserving .git)**

Run:
```bash
rsync -a JeumpaLLM-from-gitlab/ ./
```

**Step 3: Verify key files moved correctly**

Run:
```bash
ls jeumpa.py start.sh config.yaml .git
```
Expected: all 4 exist at root

**Step 4: Remove now-empty GitLab dir**

Run:
```bash
rm -rf JeumpaLLM-from-gitlab/
```

**Step 5: Verify no broken paths**

Run:
```bash
grep -r 'JeumpaLLM-from-gitlab' --include='*.py' --include='*.sh' --include='*.md' --include='*.yaml' . 2>/dev/null
```
Expected: no matches (no hardcoded references to the old path)

**Step 6: Commit**

```bash
git add -A && git commit -m "merge: promote JeumpaLLM-from-gitlab to repo root"
```

---

## Task 8: Update AGENTS.md with Final Clean State

**Files:**
- Modify: `AGENTS.md` (at repo root)

**Step 1: Read current AGENTS.md**

Run:
```bash
cat AGENTS.md
```

**Step 2: Rewrite to reflect final state**

The `JeumpaLLM-feom-codeberg` and `JeumpaLLM-from-github` sections are removed. The Node.js reference section is kept but simplified. The "Variants" table becomes a "History" note.

New content replaces the old — see commit for exact content.

**Step 3: Commit**

```bash
git add -A && git commit -m "docs: update AGENTS.md to reflect single-repo state"
```

---

## Task 9: Final Verification — Health Check

**Step 1: Verify core files exist**

Run:
```bash
required_files="jeumpa.py start.sh config.yaml .env.example .jeumpa_root ARCHITECTURE.md CHANGELOG.md README.md"
for f in $required_files; do
  [ -f "$f" ] && echo "OK: $f" || echo "MISSING: $f"
done
```
Expected: "OK:" for all files

**Step 2: Verify key modules import cleanly**

Run:
```bash
python3 -c "
import sys
sys.path.insert(0, '.')
from jeumpa_paths import get_home, get_data_root, get_os
from router import Router
from task_router import TaskRouter
print('All imports OK')
"
```
Expected: "All imports OK"

**Step 3: Verify start.sh syntax**

Run:
```bash
bash -n start.sh && echo "start.sh syntax OK"
```
Expected: "start.sh syntax OK"

**Step 4: Verify no stray zips or duplicate dirs**

Run:
```bash
find . -maxdepth 1 -name '*.zip' -o -name '*feom*' -o -name '*from-github*' -o -name '*from-gitlab*'
```
Expected: no matches (all cleaned up)

**Step 5: Commit**

```bash
git add -A && git commit -m "chore: final verification — everything clean"
```

---

## Post-Merge Notes

- **Node.js v1.0 reference** still in `Jeumpa-LLM-from-github/` if kept; or also cleaned up if not needed
- **archive/proxygatellm/source/** preserved — contains Node.js source code for historical reference
- **Git history** preserved via GitLab clone's `.git/` — all commits intact
- **Canonical remote**: GitLab (`https://gitlab.com/mulkymalikuldhr/JeumpaLLM.git`)
- **Mirrors**: Codeberg (`https://codeberg.org/Dhaher-Labs/JeumpaLLM.git`)
