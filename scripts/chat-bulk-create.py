#!/usr/bin/env python3
"""
chat-bulk-create.py v2 — API-based domain chat creation (Chrome-free)
Usage:
  python3 chat-bulk-create.py                    # URL空ドメインを全部作成
  python3 chat-bulk-create.py m1311 m1322        # 指定ドメインのみ
  python3 chat-bulk-create.py --dry-run          # 作成予定の一覧表示のみ
  python3 chat-bulk-create.py --recreate m1311   # URL既存でも再作成
"""
import sys, os, json, subprocess, glob
from datetime import datetime
from pathlib import Path

try:
    import yaml
except ImportError:
    print("ERROR: pip install pyyaml"); sys.exit(1)

YAML_PATH = os.path.expanduser("~/claude-telegram-bot/autonomous/state/chat-routing.yaml")
SCRIPTS_DIR = os.path.expanduser("~/claude-telegram-bot/scripts")
PROJECT_BASE = os.path.expanduser("~/Machinelab Dropbox/machinelab/プロジェクト")
OBSIDIAN_LIST = None  # read from yaml

def load_yaml():
    with open(YAML_PATH) as f:
        return yaml.safe_load(f)

def save_yaml(cfg):
    with open(YAML_PATH, "w") as f:
        yaml.dump(cfg, f, allow_unicode=True, default_flow_style=False, sort_keys=False, width=200)
    # Sync Obsidian chat list
    try:
        subprocess.run(["python3", f"{SCRIPTS_DIR}/chat-router.py", "sync-obsidian"],
                       capture_output=True, timeout=5)
    except Exception:
        pass

def find_project_folder(domain_name):
    """Find Dropbox project folder matching domain name (e.g. m1311 -> M1311_*)"""
    # Extract M-number from domain name
    m_num = domain_name.upper().replace("M", "M")
    if not m_num.startswith("M"):
        return None
    pattern = os.path.join(PROJECT_BASE, f"{m_num}_*")
    matches = glob.glob(pattern)
    if matches:
        return matches[0]
    # Try without underscore
    pattern2 = os.path.join(PROJECT_BASE, f"{m_num}*")
    matches2 = glob.glob(pattern2)
    return matches2[0] if matches2 else None

def generate_file_tree(folder_path, max_depth=2, max_files=50):
    """Generate a concise file tree listing for bootstrap injection"""
    lines = []
    count = 0
    base = Path(folder_path)
    
    for root, dirs, files in os.walk(folder_path):
        depth = len(Path(root).relative_to(base).parts)
        if depth > max_depth:
            continue
        indent = "  " * depth
        if depth > 0:
            lines.append(f"{indent}📁 {Path(root).name}/")
        for f in sorted(files):
            if count >= max_files:
                lines.append(f"{indent}  ... (他 {sum(len(fs) for _, _, fs in os.walk(folder_path)) - count}件)")
                return "\n".join(lines)
            ext = Path(f).suffix.lower()
            if ext in ('.ds_store', '.tmp', '.bak'):
                continue
            lines.append(f"{indent}  {f}")
            count += 1
    return "\n".join(lines)

def create_chat(project_uuid, title):
    """Create chat via API, return UUID"""
    result = subprocess.run(
        ["python3", f"{SCRIPTS_DIR}/stateless-handoff.py", project_uuid, "--name", title],
        capture_output=True, text=True, timeout=15
    )
    uuid = result.stdout.strip()
    if uuid and len(uuid) == 36:
        return uuid
    print(f"  ERROR: create failed: {result.stderr or result.stdout}")
    return None

def main():
    dry_run = "--dry-run" in sys.argv
    recreate = "--recreate" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]

    cfg = load_yaml()
    project_uuid = cfg.get("default_project", "019c15f4-3d2d-7263-a308-e7f6ccd6b3f8")
    domains = cfg.get("domains", {})
    today = datetime.now().strftime("%Y-%m-%d")

    # Determine targets
    if args:
        targets = [a for a in args if a in domains]
        if not targets:
            # Maybe new domain - create entry
            for a in args:
                if a not in domains:
                    print(f"Domain '{a}' not in yaml. Add it first.")
            return
    else:
        targets = [name for name, d in domains.items() if not d.get("url", "")]

    if not targets:
        print("No domains to create. All have URLs.")
        return

    print(f"{'[DRY RUN] ' if dry_run else ''}Creating {len(targets)} domain chat(s):\n")

    for domain_name in targets:
        d = domains[domain_name]
        url = d.get("url", "")
        if url and not recreate:
            print(f"SKIP {domain_name}: already has URL")
            continue

        title = d.get("title_template", f"{{date}}_{domain_name}").replace("{date}", today)
        bootstrap = d.get("bootstrap", "")

        # Find project folder and generate context
        folder = find_project_folder(domain_name)
        folder_context = ""
        if folder:
            folder_name = Path(folder).name
            tree = generate_file_tree(folder)
            folder_context = f"\n\n## プロジェクトフォルダ\nパス: ~/Machinelab Dropbox/machinelab/プロジェクト/{folder_name}/\n\n### ファイル一覧\n```\n{tree}\n```"
            print(f"  📁 {folder_name} ({tree.count(chr(10))+1} items)")

        full_bootstrap = bootstrap.rstrip()
        if folder_context:
            full_bootstrap += folder_context

        print(f"  {domain_name}: {title}")
        print(f"    bootstrap: {len(full_bootstrap)} chars" + (" (with folder)" if folder_context else ""))

        if dry_run:
            continue

        # Create chat
        uuid = create_chat(project_uuid, title)
        if not uuid:
            continue

        new_url = f"https://claude.ai/chat/{uuid}"
        print(f"    ✅ {new_url}")

        # Archive old URL if recreating
        if url and recreate:
            try:
                subprocess.run(
                    ["python3", f"{SCRIPTS_DIR}/chat-router.py", "archive-url", domain_name],
                    capture_output=True, timeout=5
                )
            except Exception:
                pass

        # Update yaml
        domains[domain_name]["url"] = new_url
        save_yaml(cfg)

        # Save bootstrap as summary file for relay prepend
        summary_path = f"/tmp/handoff-summary-{domain_name}.md"
        with open(summary_path, "w") as f:
            f.write(full_bootstrap)
        print(f"    📄 summary saved: {summary_path}")

    print("\nDone.")

if __name__ == "__main__":
    main()
