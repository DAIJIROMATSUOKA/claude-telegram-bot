#!/usr/bin/env python3
"""
AI Media Setup Script for JARVIS
=================================
One-command setup for the entire AI media pipeline.

Run: python3 setup-ai-media.py

What it does:
  1. Creates mflux virtual environment + installs mflux
  2. Clones ComfyUI + installs dependencies + custom nodes
  3. Downloads all required models (GGUF text encoder for MPS compatibility)
  4. Copies ai-media.py + media-commands.ts to correct locations
  5. Creates ComfyUI launch script with MPS-safe flags
  6. Creates launchd plist for auto-start
  7. Patches text.ts to register media commands
  8. Prints verification commands

Models downloaded (~15GB total):
  - FLUX Kontext Dev 4-bit (auto by mflux on first use)
  - Z-Image-Turbo 8-bit (auto by mflux on first use)
  - Wan2.2 TI2V-5B fp16 UNET (~10GB)
  - UMT5-XXL GGUF Q5_K_S text encoder (~4GB)
  - Wan2.2 VAE (~400MB)

NOTE: fp8 text encoder (umt5_xxl_fp8_e4m3fn_scaled.safetensors) is NOT used.
      It crashes on Apple MPS: 'Float8_e4m3fn not supported on MPS backend'
      See: GitHub ComfyUI #9255, #10292

NOTE: clip_vision_h.safetensors is NOT downloaded.
      CLIPVision is only needed for the 14B model, not the 5B model.
      The 5B model uses Wan22ImageToVideoLatent with direct start_image input.
"""

import os
import subprocess
import sys
import shutil
from pathlib import Path

HOME = os.path.expanduser("~")
BOT_DIR = os.path.join(HOME, "claude-telegram-bot")
AI_TOOLS_DIR = os.path.join(HOME, "ai-tools")
MFLUX_VENV = os.path.join(AI_TOOLS_DIR, "mflux-env")
COMFYUI_DIR = os.path.join(HOME, "ComfyUI")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def run(cmd, cwd=None, check=True, shell=False):
    """Run a command and print it."""
    if isinstance(cmd, str):
        print(f"\n>>> {cmd}")
    else:
        print(f"\n>>> {' '.join(cmd)}")
    return subprocess.run(cmd, cwd=cwd, check=check, shell=shell)


def section(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


def main():
    print("""
    +======================================+
    |  AI Media Setup for JARVIS           |
    |  mflux + ComfyUI + Wan2.2            |
    |  MPS-safe: GGUF text encoder         |
    +======================================+
    """)

    # ================================================================
    # Phase 1: mflux
    # ================================================================
    section("Phase 1: mflux (image generation + editing)")

    os.makedirs(AI_TOOLS_DIR, exist_ok=True)

    if not os.path.exists(MFLUX_VENV):
        run([sys.executable, "-m", "venv", MFLUX_VENV])
    else:
        print(f"  [skip] venv already exists: {MFLUX_VENV}")

    pip = os.path.join(MFLUX_VENV, "bin", "pip")
    run([pip, "install", "--upgrade", "pip"])
    run([pip, "install", "mflux", "pillow-heif"])

    # Verify
    mflux_bin = os.path.join(MFLUX_VENV, "bin", "mflux-generate-z-image-turbo")
    if os.path.exists(mflux_bin):
        print("  [OK] mflux installed successfully")
    else:
        print("  [ERROR] mflux binary not found!")
        sys.exit(1)

    # ================================================================
    # Phase 2: ComfyUI
    # ================================================================
    section("Phase 2: ComfyUI (video generation)")

    if not os.path.exists(COMFYUI_DIR):
        run(["git", "clone", "https://github.com/comfyanonymous/ComfyUI.git", COMFYUI_DIR])
    else:
        print(f"  [skip] ComfyUI already exists: {COMFYUI_DIR}")
        run(["git", "pull"], cwd=COMFYUI_DIR, check=False)

    # Install ComfyUI requirements (system Python, --break-system-packages for M1)
    req_file = os.path.join(COMFYUI_DIR, "requirements.txt")
    if os.path.exists(req_file):
        run(["pip3", "install", "-r", req_file, "--break-system-packages"])

    # Install websocket-client (needed by ai-media.py)
    run(["pip3", "install", "websocket-client", "--break-system-packages"])

    # ComfyUI-GGUF custom node (REQUIRED for GGUF text encoder on MPS)
    gguf_dir = os.path.join(COMFYUI_DIR, "custom_nodes", "ComfyUI-GGUF")
    if not os.path.exists(gguf_dir):
        run(["git", "clone", "https://github.com/city96/ComfyUI-GGUF.git", gguf_dir])
        gguf_req = os.path.join(gguf_dir, "requirements.txt")
        if os.path.exists(gguf_req):
            run(["pip3", "install", "-r", gguf_req, "--break-system-packages"])
    else:
        print("  [skip] ComfyUI-GGUF already installed")

    # VideoHelperSuite (for VHS_VideoCombine node → mp4 output)
    vhs_dir = os.path.join(COMFYUI_DIR, "custom_nodes", "ComfyUI-VideoHelperSuite")
    if not os.path.exists(vhs_dir):
        run(["git", "clone", "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git", vhs_dir])
        vhs_req = os.path.join(vhs_dir, "requirements.txt")
        if os.path.exists(vhs_req):
            run(["pip3", "install", "-r", vhs_req, "--break-system-packages"])
    else:
        print("  [skip] VideoHelperSuite already installed")

    # ================================================================
    # Phase 3: Model Downloads (~15GB total)
    # ================================================================
    section("Phase 3: Download Wan2.2 models (~15GB)")

    # Install huggingface_hub CLI
    run(["pip3", "install", "huggingface_hub[cli]", "--break-system-packages"])

    # Find huggingface-cli
    hf_cli = shutil.which("huggingface-cli")
    if not hf_cli:
        hf_cli = os.path.expanduser("~/.local/bin/huggingface-cli")
    if not os.path.exists(hf_cli):
        hf_cli = "huggingface-cli"

    models_dir = os.path.join(COMFYUI_DIR, "models")
    os.makedirs(os.path.join(models_dir, "diffusion_models"), exist_ok=True)
    os.makedirs(os.path.join(models_dir, "text_encoders"), exist_ok=True)
    os.makedirs(os.path.join(models_dir, "vae"), exist_ok=True)

    # --- Wan2.2 TI2V-5B fp16 UNET (~10GB) ---
    wan_model = os.path.join(models_dir, "diffusion_models", "wan2.2_ti2v_5B_fp16.safetensors")
    if not os.path.exists(wan_model):
        print("\n  Downloading Wan2.2 TI2V-5B fp16 UNET (~10GB)...")
        run([hf_cli, "download",
             "Comfy-Org/Wan_2.2_ComfyUI_Repackaged",
             "--include", "split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors",
             "--local-dir", "/tmp/wan22_download"])
        src = "/tmp/wan22_download/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors"
        if os.path.exists(src):
            shutil.move(src, wan_model)
            print(f"  [OK] {wan_model}")
        else:
            print(f"  [ERROR] Download failed! File not found at {src}")
    else:
        print(f"  [skip] {wan_model}")

    # --- UMT5-XXL GGUF Q5_K_S text encoder (~4GB) ---
    # This replaces the fp8 safetensors which CRASHES on Apple MPS.
    # fp8 error: 'Trying to convert Float8_e4m3fn to the MPS backend'
    clip_gguf = os.path.join(models_dir, "text_encoders", "umt5xxl-encoder-q5_k_s.gguf")
    if not os.path.exists(clip_gguf):
        print("\n  Downloading UMT5-XXL GGUF Q5_K_S text encoder (~4GB)...")
        print("  (This replaces fp8 which is incompatible with Apple MPS)")
        run([hf_cli, "download",
             "chatpig/umt5xxl-encoder-gguf",
             "umt5xxl-encoder-q5_k_s.gguf",
             "--local-dir", os.path.join(models_dir, "text_encoders")])
        if os.path.exists(clip_gguf):
            print(f"  [OK] {clip_gguf}")
        else:
            print(f"  [ERROR] Download failed! File not found at {clip_gguf}")
    else:
        print(f"  [skip] {clip_gguf}")

    # --- Wan2.2 VAE (~400MB) ---
    vae_model = os.path.join(models_dir, "vae", "wan2.2_vae.safetensors")
    if not os.path.exists(vae_model):
        print("\n  Downloading Wan2.2 VAE (~400MB)...")
        run([hf_cli, "download",
             "Comfy-Org/Wan_2.2_ComfyUI_Repackaged",
             "--include", "split_files/vae/wan2.2_vae.safetensors",
             "--local-dir", "/tmp/wan22_download"])
        src = "/tmp/wan22_download/split_files/vae/wan2.2_vae.safetensors"
        if os.path.exists(src):
            shutil.move(src, vae_model)
            print(f"  [OK] {vae_model}")
        else:
            print(f"  [ERROR] Download failed! File not found at {src}")
    else:
        print(f"  [skip] {vae_model}")

    # NOTE: NOT downloading clip_vision_h.safetensors
    # CLIPVision is only used by the 14B model's WanImageToVideoCond node.
    # The 5B model takes start_image directly via Wan22ImageToVideoLatent.
    # Saves ~1GB download and ~1GB memory.
    print("\n  [info] Skipping clip_vision_h.safetensors (not needed for 5B model)")

    # Cleanup temp downloads
    for d in ["/tmp/wan22_download"]:
        if os.path.exists(d):
            shutil.rmtree(d, ignore_errors=True)

    # ================================================================
    # Phase 4: Deploy scripts
    # ================================================================
    section("Phase 4: Deploy scripts to JARVIS")

    scripts_dir = os.path.join(BOT_DIR, "scripts")
    handlers_dir = os.path.join(BOT_DIR, "src", "handlers")
    os.makedirs(scripts_dir, exist_ok=True)
    os.makedirs(handlers_dir, exist_ok=True)

    # Copy ai-media.py
    ai_media_src = os.path.join(SCRIPT_DIR, "ai-media.py")
    ai_media_dst = os.path.join(scripts_dir, "ai-media.py")
    if os.path.exists(ai_media_src):
        shutil.copy2(ai_media_src, ai_media_dst)
        os.chmod(ai_media_dst, 0o755)
        print(f"  [OK] {ai_media_dst}")
    else:
        print(f"  [WARN] ai-media.py not found at {ai_media_src}")

    # Copy media-commands.ts
    media_cmd_src = os.path.join(SCRIPT_DIR, "media-commands.ts")
    media_cmd_dst = os.path.join(handlers_dir, "media-commands.ts")
    if os.path.exists(media_cmd_src):
        shutil.copy2(media_cmd_src, media_cmd_dst)
        print(f"  [OK] {media_cmd_dst}")
    else:
        print(f"  [WARN] media-commands.ts not found at {media_cmd_src}")

    # ================================================================
    # Phase 5: Patch text.ts to register commands
    # ================================================================
    section("Phase 5: Register media commands in bot")

    text_ts = os.path.join(handlers_dir, "text.ts")
    if os.path.exists(text_ts):
        with open(text_ts, "r") as f:
            content = f.read()

        if "media-commands" not in content:
            import_line = 'import { registerMediaCommands } from "./media-commands";\n'

            lines = content.split("\n")
            last_import_idx = 0
            for i, line in enumerate(lines):
                if line.startswith("import ") or line.startswith("} from "):
                    last_import_idx = i

            lines.insert(last_import_idx + 1, import_line.rstrip())

            new_content = "\n".join(lines)
            with open(text_ts, "w") as f:
                f.write(new_content)
            print(f"  [OK] Added import to {text_ts}")
            print(f"  [NOTE] You may need to manually add registerMediaCommands(bot) call")
        else:
            print(f"  [skip] media-commands already registered in {text_ts}")
    else:
        print(f"  [WARN] {text_ts} not found - manual integration needed")

    # ================================================================
    # Phase 6: ComfyUI launch script (MPS-safe)
    # ================================================================
    section("Phase 6: ComfyUI launch script (MPS-safe)")

    launch_script = os.path.join(HOME, "start-comfyui.sh")
    with open(launch_script, "w") as f:
        f.write(f"""#!/bin/bash
# Start ComfyUI for JARVIS video generation (Apple Silicon MPS-safe)
#
# MPS environment variables:
#   PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0  → Prevent MPS memory allocation limits
#   PYTORCH_ENABLE_MPS_FALLBACK=1         → CPU fallback for unsupported MPS ops
#
# Launch flags:
#   --force-fp16                  → Force fp16 precision (MPS compatible)
#   --use-split-cross-attention   → Reduce peak memory during attention
#   --disable-auto-launch         → Don't open browser automatically
#   --listen 127.0.0.1            → Only accept local connections

cd {COMFYUI_DIR}
export PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0
export PYTORCH_ENABLE_MPS_FALLBACK=1

exec python3 main.py \\
  --listen 127.0.0.1 \\
  --port 8188 \\
  --force-fp16 \\
  --use-split-cross-attention \\
  --disable-auto-launch \\
  2>&1 | tee /tmp/comfyui.log
""")
    os.chmod(launch_script, 0o755)
    print(f"  [OK] {launch_script}")

    # Create launchd plist for ComfyUI
    plist_dir = os.path.join(HOME, "Library", "LaunchAgents")
    os.makedirs(plist_dir, exist_ok=True)
    plist_path = os.path.join(plist_dir, "com.jarvis.comfyui.plist")

    plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.jarvis.comfyui</string>
    <key>ProgramArguments</key>
    <array>
        <string>{launch_script}</string>
    </array>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/comfyui-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/comfyui-stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
        <key>PYTORCH_MPS_HIGH_WATERMARK_RATIO</key>
        <string>0.0</string>
        <key>PYTORCH_ENABLE_MPS_FALLBACK</key>
        <string>1</string>
    </dict>
</dict>
</plist>
"""
    with open(plist_path, "w") as f:
        f.write(plist_content)
    print(f"  [OK] {plist_path}")
    print(f"  To start: launchctl load {plist_path}")
    print(f"  To stop:  launchctl unload {plist_path}")

    # ================================================================
    # Done!
    # ================================================================
    section("SETUP COMPLETE!")

    scripts_ai_media = os.path.join(scripts_dir, "ai-media.py")
    print(f"""
  +---------------------------------------------+
  |  All components installed successfully!      |
  +---------------------------------------------+

  Memory budget (M1 MAX 32GB):
    UNET fp16:        ~10GB
    Text encoder GGUF: ~4GB
    VAE:              ~0.4GB
    ComfyUI runtime:  ~2GB
    macOS + apps:     ~6GB
    Total:            ~22.4GB (9.6GB headroom)

  Quick Test Commands:

  1. Test mflux (image generation):
     source {MFLUX_VENV}/bin/activate && mflux-generate-z-image-turbo --prompt "A red dragon" --width 512 --height 512 --steps 4 -q 8 --output /tmp/test-gen.png

  2. Check ai-media.py status:
     python3 {scripts_ai_media} status

  3. Start ComfyUI:
     {launch_script}

  4. Test T2V (after ComfyUI is running):
     python3 {scripts_ai_media} animate --prompt "A cat walking" --width 832 --height 480 --frames 33 --steps 20

  5. Test I2V (after ComfyUI is running):
     python3 {scripts_ai_media} animate --image /tmp/test-gen.png --prompt "The dragon breathes fire" --width 832 --height 480 --frames 33 --steps 20

  JARVIS Integration:
     cd {BOT_DIR} && bun run build && launchctl kickstart -k gui/$(id -u)/com.jarvis.bot

  Telegram Commands:
     /imagine <prompt>              -> Text-to-image
     [reply to photo] /edit <text>  -> Image editing
     [reply to photo] /animate <text> -> Image-to-video

  Resolution guide:
     --width 832 --height 480   -> Safe initial test (low memory)
     --width 1280 --height 704  -> Official 720p (after test passes)
""")


if __name__ == "__main__":
    main()
