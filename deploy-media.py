#!/usr/bin/env python3
"""
deploy-media.py
===============
Deploy /animate, /imagine, /edit commands to JARVIS Telegram bot.

Actions:
  1. Copy media-commands.ts to src/handlers/
  2. Copy ai-media.py to scripts/
  3. Patch src/index.ts to register media commands
  4. Create ~/start-comfyui.sh startup script
  5. Create ~/ComfyUI/models/ symlinks if needed

Usage:
  python3 deploy-media.py           # dry-run (show what would happen)
  python3 deploy-media.py --apply   # apply changes
"""

import os
import sys
import shutil

BOT_DIR = os.path.expanduser("~/claude-telegram-bot")
COMFYUI_DIR = os.path.expanduser("~/ComfyUI")
DRY_RUN = "--apply" not in sys.argv

def log(msg):
    prefix = "[DRY-RUN]" if DRY_RUN else "[APPLY]"
    print(f"  {prefix} {msg}")

def ensure_file(src, dst):
    """Copy file if source exists."""
    if not os.path.exists(src):
        print(f"  ERROR: Source not found: {src}")
        return False
    if DRY_RUN:
        log(f"Would copy {src} -> {dst}")
        return True
    shutil.copy2(src, dst)
    log(f"Copied {src} -> {dst}")
    return True

def patch_file(filepath, marker, insert_text):
    """Insert text before marker line if not already present."""
    if not os.path.exists(filepath):
        print(f"  ERROR: File not found: {filepath}")
        return False

    with open(filepath, "r") as f:
        content = f.read()

    # Already patched?
    if "media-commands" in content:
        log(f"Already patched: {filepath}")
        return True

    if marker not in content:
        print(f"  WARNING: Marker not found in {filepath}: {marker!r}")
        print(f"  Manual patch required. Add these lines:")
        print(f'    import {{ registerMediaCommands }} from "./handlers/media-commands";')
        print(f"    // After bot creation: registerMediaCommands(bot);")
        return False

    if DRY_RUN:
        log(f"Would patch {filepath} (insert before: {marker!r})")
        return True

    new_content = content.replace(marker, insert_text + "\n" + marker)
    with open(filepath, "w") as f:
        f.write(new_content)
    log(f"Patched {filepath}")
    return True

def create_comfyui_script():
    """Create ~/start-comfyui.sh for easy ComfyUI startup."""
    script_path = os.path.expanduser("~/start-comfyui.sh")
    script_content = """#!/bin/bash
# Start ComfyUI with MPS-safe flags
export PYTORCH_ENABLE_MPS_FALLBACK=1
export PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0
cd ~/ComfyUI
echo "Starting ComfyUI on http://0.0.0.0:8188 ..."
python3 main.py --force-fp16 --use-split-cross-attention --listen "$@"
"""
    if DRY_RUN:
        log(f"Would create {script_path}")
        return True
    with open(script_path, "w") as f:
        f.write(script_content)
    os.chmod(script_path, 0o755)
    log(f"Created {script_path}")
    return True

def main():
    print("=" * 60)
    print("JARVIS Media Commands Deployment")
    print("=" * 60)
    if DRY_RUN:
        print("DRY-RUN mode. Use --apply to execute.\n")
    else:
        print("APPLYING changes.\n")

    ok = True
    scripts_dir = os.path.join(BOT_DIR, "scripts")
    handlers_dir = os.path.join(BOT_DIR, "src", "handlers")

    # 1. Copy media-commands.ts
    print("[1/5] media-commands.ts -> src/handlers/")
    src_mc = os.path.join(BOT_DIR, "media-commands.ts")
    # Also check scripts dir and current dir
    for candidate in [src_mc,
                      os.path.join(scripts_dir, "media-commands.ts"),
                      os.path.join(BOT_DIR, "src", "handlers", "media-commands.ts")]:
        if os.path.exists(candidate):
            src_mc = candidate
            break

    dst_mc = os.path.join(handlers_dir, "media-commands.ts")
    if os.path.exists(dst_mc):
        log(f"Already exists: {dst_mc}")
    elif os.path.exists(src_mc) and src_mc != dst_mc:
        ok = ensure_file(src_mc, dst_mc) and ok
    else:
        print(f"  ERROR: media-commands.ts not found.")
        print(f"  Please place it at: {dst_mc}")
        ok = False

    # 2. Copy ai-media.py
    print("\n[2/5] ai-media.py -> scripts/")
    dst_ai = os.path.join(scripts_dir, "ai-media.py")
    if os.path.exists(dst_ai):
        log(f"Already exists: {dst_ai}")
    else:
        print(f"  ERROR: ai-media.py not found in scripts/")
        ok = False

    # 3. Patch src/index.ts - register media commands
    print("\n[3/5] Patch src/index.ts")
    index_ts = os.path.join(BOT_DIR, "src", "index.ts")

    # Strategy: find the import section and add import + registration
    # We look for "runner" or "bot.start" as a marker to insert before
    if os.path.exists(index_ts):
        with open(index_ts, "r") as f:
            index_content = f.read()

        if "media-commands" in index_content:
            log("Already patched: index.ts")
        else:
            # Find a good insertion point for the import
            import_marker = None
            register_marker = None

            # Find last import line
            lines = index_content.split("\n")
            last_import_idx = -1
            bot_var_name = "bot"
            runner_line_idx = -1

            for i, line in enumerate(lines):
                if line.strip().startswith("import "):
                    last_import_idx = i
                if "createRunner" in line or "runner" in line.lower() and "=" in line:
                    runner_line_idx = i
                # Try to find the bot variable name
                if "new Bot" in line or "new Grammy" in line:
                    parts = line.split("=")[0].strip().split()
                    if parts:
                        bot_var_name = parts[-1]

            if last_import_idx >= 0:
                import_line = 'import { registerMediaCommands } from "./handlers/media-commands";'
                register_line = f'registerMediaCommands({bot_var_name});'

                if DRY_RUN:
                    log(f"Would add import after line {last_import_idx + 1}")
                    log(f"Would add registration: {register_line}")
                    log(f"  Detected bot variable: {bot_var_name}")
                    log(f"  NOTE: Verify bot variable name is correct!")
                else:
                    # Insert import after last import
                    lines.insert(last_import_idx + 1, import_line)

                    # Find where to add registration (after bot creation, before runner)
                    # Re-scan since we inserted a line
                    reg_inserted = False
                    for i, line in enumerate(lines):
                        if ("runner" in line.lower() and "=" in line) or "run(" in line:
                            lines.insert(i, register_line)
                            reg_inserted = True
                            break

                    if not reg_inserted:
                        # Fallback: add right after import
                        lines.insert(last_import_idx + 2, register_line)
                        log("WARNING: Could not find runner line, added after imports")

                    with open(index_ts, "w") as f:
                        f.write("\n".join(lines))
                    log("Patched index.ts")
            else:
                print("  WARNING: No import statements found in index.ts")
                print("  Manual patch required:")
                print(f'    import {{ registerMediaCommands }} from "./handlers/media-commands";')
                print(f"    registerMediaCommands(bot);")
    else:
        print(f"  ERROR: {index_ts} not found")
        ok = False

    # 4. Create ComfyUI startup script
    print("\n[4/5] Create ~/start-comfyui.sh")
    create_comfyui_script()

    # 5. Verify models
    print("\n[5/5] Verify ComfyUI models")
    models = {
        "UNET (fp16)": os.path.join(COMFYUI_DIR, "models", "diffusion_models", "wan2.2_ti2v_5B_fp16.safetensors"),
        "VAE": os.path.join(COMFYUI_DIR, "models", "vae", "wan2.2_vae.safetensors"),
        "Text Encoder (GGUF)": os.path.join(COMFYUI_DIR, "models", "text_encoders", "umt5xxl-encoder-q5_k_s.gguf"),
    }
    for name, path in models.items():
        if os.path.exists(path):
            size_mb = os.path.getsize(path) / (1024 * 1024)
            log(f"OK: {name} ({size_mb:.0f} MB)")
        else:
            print(f"  MISSING: {name} -> {path}")
            ok = False

    # Summary
    print("\n" + "=" * 60)
    if ok:
        print("All checks passed!")
        if DRY_RUN:
            print("Run with --apply to execute.")
        else:
            print("Deployment complete!")
            print("\nNext steps:")
            print("  1. bun build (or bun run build)")
            print("  2. ~/start-comfyui.sh  (in separate terminal)")
            print("  3. bun run start (restart bot)")
            print("  4. Test: /animate a red dragon flying")
    else:
        print("Some checks failed. Fix issues above and re-run.")
    print("=" * 60)

if __name__ == "__main__":
    main()
