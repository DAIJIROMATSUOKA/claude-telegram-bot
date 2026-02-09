#!/usr/bin/env python3
"""
AI Media Engine for JARVIS
==========================
Unified interface for image generation, image editing, and video generation.

Usage:
  python3 ai-media.py generate --prompt "..." --output /tmp/out.png
  python3 ai-media.py edit --image /tmp/input.jpg --prompt "..." --output /tmp/out.png
  python3 ai-media.py outpaint --image /tmp/input.jpg --prompt "..." --output /tmp/out.png
  python3 ai-media.py animate --image /tmp/input.png --prompt "..." --output /tmp/out.mp4
  python3 ai-media.py status

Models:
  generate → Z-Image-Turbo 8-bit (mflux, MLX native, ~160s)
  edit     → FLUX.1 Dev Q5 + LoRA (ComfyUI API, img2img, ~10-15min)
  outpaint → FLUX.1 Dev Q5 + LoRA (ComfyUI API, outpainting, ~10-15min)
  animate  → Wan2.2 TI2V-5B (ComfyUI API, ~15-30min)

Requirements:
  pip install mflux pillow-heif websocket-client
  ComfyUI running at localhost:8188 (for video only)

Bug Fixes Applied (2026-02-07):
  1. EmptyWan22LatentVideo → Wan22ImageToVideoLatent (correct node name)
  2. ModelSamplingSD3 added between UNETLoader and KSampler (shift=3.0)
  3. I2V: removed 14B-only CLIPVision nodes, use start_image directly
  4. Resolution 480x480 → 832x480 default (official 720p: 1280x704)
  5. KSampler: cfg 5.0→3.5, sampler uni_pc_bh2→euler, scheduler normal→simple
  6. Text encoder: fp8 (MPS incompatible) → GGUF Q5_K_S (MPS proven)
"""

import argparse
import json
import os
import subprocess
import sys
import time
import uuid
import urllib.request
import urllib.parse
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
COMFYUI_URL = os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188")
MFLUX_VENV = os.environ.get("MFLUX_VENV", os.path.expanduser("~/ai-tools/mflux-env"))
COMFYUI_DIR = os.environ.get("COMFYUI_DIR", os.path.expanduser("~/ComfyUI"))
WORKING_DIR = os.environ.get("AI_MEDIA_WORKDIR", "/tmp/ai-media")

# --- Wan2.2 TI2V-5B model config ---
# UNET: fp16 safetensors (works on MPS, ~10GB)
WAN22_MODEL = os.environ.get("WAN22_MODEL", "wan2.2_ti2v_5B_fp16.safetensors")

# Text encoder: GGUF is DEFAULT because fp8 is INCOMPATIBLE with Apple MPS backend.
# See: GitHub ComfyUI #9255, #10292 — Float8_e4m3fn not supported on MPS
# Options: "gguf" (default, 4.05GB, proven on Apple Silicon)
#          "fp16" (11.4GB, works but tight on 32GB)
WAN22_TEXT_ENCODER_TYPE = os.environ.get("WAN22_TEXT_ENCODER_TYPE", "gguf")
WAN22_CLIP_GGUF = os.environ.get("WAN22_CLIP_GGUF", "umt5xxl-encoder-q5_k_s.gguf")
WAN22_CLIP_FP16 = os.environ.get("WAN22_CLIP_FP16", "umt5_xxl_fp16.safetensors")

# VAE
WAN22_VAE = "wan2.2_vae.safetensors"

# ModelSamplingSD3 shift parameter (default 3.0, range 0-100, typical 3.0-5.0)
WAN22_SHIFT = float(os.environ.get("WAN22_SHIFT", "3.0"))

# UNET GGUF option (if using quantized UNET instead of fp16)
WAN22_USE_GGUF_UNET = os.environ.get("WAN22_USE_GGUF_UNET", "0") == "1"
WAN22_GGUF_UNET_MODEL = os.environ.get("WAN22_GGUF_UNET_MODEL", "wan2.2-ti2v-5b-Q5_K_S.gguf")

# NOTE: clip_vision_h.safetensors is NOT needed for 5B model.
# CLIPVision is only used by the 14B model's WanImageToVideoCond node.
# The 5B model uses Wan22ImageToVideoLatent with direct start_image input.

# --- FLUX.1 Dev img2img config (for /edit via ComfyUI) ---
FLUX_DEV_UNET = os.environ.get("FLUX_DEV_UNET", "flux1-dev-Q5_K_S.gguf")
FLUX_DEV_CLIP_L = os.environ.get("FLUX_DEV_CLIP_L", "clip_l.safetensors")
FLUX_DEV_T5 = os.environ.get("FLUX_DEV_T5", "t5-v1_1-xxl-encoder-Q5_K_M.gguf")
FLUX_DEV_VAE = os.environ.get("FLUX_DEV_VAE", "ae.safetensors")
FLUX_DEV_LORA = os.environ.get("FLUX_DEV_LORA", "roundassv16_FLUX.safetensors")
FLUX_DEV_LORA_STRENGTH = float(os.environ.get("FLUX_DEV_LORA_STRENGTH", "0.8"))
FLUX_DEV_EXTRA_LORAS = os.environ.get("FLUX_DEV_EXTRA_LORAS", "flux-lora-uncensored.safetensors:0.9,undressing_flux_v3.safetensors:1.3")


def ensure_workdir():
    os.makedirs(WORKING_DIR, exist_ok=True)


def get_mflux_bin(cmd: str) -> str:
    """Get mflux binary path, preferring venv if it exists."""
    venv_bin = os.path.join(MFLUX_VENV, "bin", cmd)
    if os.path.exists(venv_bin):
        return venv_bin
    return cmd


MAX_IMAGE_DIMENSION = 1536  # Max pixels on longest side (FLUX works at 1024, extra margin for quality)


def convert_and_resize(input_path: str) -> str:
    """Convert HEIC/WEBP/etc to PNG and resize large images for MPS compatibility."""
    ext = Path(input_path).suffix.lower()
    needs_convert = ext not in (".jpg", ".jpeg", ".png")
    needs_resize = False

    try:
        if ext in (".heic", ".heif"):
            try:
                import pillow_heif
                pillow_heif.register_heif_opener()
            except ImportError:
                print("WARNING: pillow-heif not installed, HEIC conversion may fail", file=sys.stderr)

        from PIL import Image
        img = Image.open(input_path).convert("RGB")
        w, h = img.size

        # Check if resize needed
        if max(w, h) > MAX_IMAGE_DIMENSION:
            needs_resize = True
            ratio = MAX_IMAGE_DIMENSION / max(w, h)
            new_w = int(w * ratio)
            new_h = int(h * ratio)
            # Round to nearest multiple of 8 (required by FLUX)
            new_w = (new_w // 8) * 8
            new_h = (new_h // 8) * 8
            img = img.resize((new_w, new_h), Image.LANCZOS)
            print(f"[ai-media] Resized {w}x{h} -> {new_w}x{new_h} (MPS compatibility)", file=sys.stderr)

        if needs_convert or needs_resize:
            output_path = os.path.join(WORKING_DIR, f"converted_{uuid.uuid4().hex[:8]}.png")
            img.save(output_path, "PNG")
            action = []
            if needs_convert:
                action.append(f"{ext} -> PNG")
            if needs_resize:
                action.append("resized")
            print(f"[ai-media] {' + '.join(action)}: {output_path}", file=sys.stderr)
            return output_path

        return input_path
    except Exception as e:
        print(f"ERROR: Image conversion/resize failed: {e}", file=sys.stderr)
        return input_path


# ===========================================================================
# IMAGE GENERATION (Z-Image-Turbo via mflux)
# ===========================================================================
def cmd_generate(args):
    """Text-to-image using Z-Image-Turbo 8-bit."""
    ensure_workdir()
    output = args.output or os.path.join(WORKING_DIR, f"gen_{uuid.uuid4().hex[:8]}.png")

    cmd = [
        get_mflux_bin("mflux-generate-z-image-turbo"),
        "--prompt", args.prompt,
        "--width", str(args.width or 1024),
        "--height", str(args.height or 1024),
        "--steps", str(args.steps or 9),
        "-q", str(args.quantize or 8),
        "--output", output,
    ]
    if args.seed is not None:
        cmd.extend(["--seed", str(args.seed)])

    print(f"[ai-media] Generating image...", file=sys.stderr)
    print(f"[ai-media] CMD: {' '.join(cmd)}", file=sys.stderr)

    t0 = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True)
    elapsed = time.time() - t0

    if result.returncode != 0:
        print(f"[ai-media] STDERR: {result.stderr}", file=sys.stderr)
        return {"ok": False, "error": result.stderr, "elapsed": elapsed}

    actual_output = find_output_file(output, WORKING_DIR)
    return {"ok": True, "path": actual_output, "elapsed": round(elapsed, 1)}


# ===========================================================================
# FACE DETECTION & MASK GENERATION (OpenCV)
# ===========================================================================
def detect_faces_and_create_mask(image_path: str, face_protect: float = 0.35) -> str | None:
    """Detect faces in image and create an inpainting mask.

    Returns path to mask image (white=edit, black=protect) or None if no faces found.
    face_protect: 0.0 = no protection (full edit), 1.0 = full protection (no change).
                  Default 0.35 = allow 65% of denoise to affect face area,
                  so face changes naturally with pose/body edits.
    """
    try:
        import cv2
        import numpy as np

        img = cv2.imread(image_path)
        if img is None:
            print("[ai-media] Could not read image for face detection", file=sys.stderr)
            return None

        h, w = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Detect faces with Haar Cascade
        cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        face_cascade = cv2.CascadeClassifier(cascade_path)
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(50, 50))

        if len(faces) == 0:
            print("[ai-media] No faces detected — skipping mask", file=sys.stderr)
            return None

        print(f"[ai-media] Detected {len(faces)} face(s), creating protection mask (protect={face_protect})", file=sys.stderr)

        # Create mask: 255=full edit, 0=full protect
        # Face core gets strong protection, surrounded by a wide gradient transition zone
        face_value = int(255 * (1.0 - face_protect))  # e.g. protect=0.35 → value=166
        mask = np.ones((h, w), dtype=np.uint8) * 255

        for (fx, fy, fw, fh) in faces:
            # --- Inner ellipse: strong face protection (core face area) ---
            inner_expand = 0.3
            iex = int(fw * inner_expand)
            iey = int(fh * inner_expand)
            ix1 = max(0, fx - iex)
            iy1 = max(0, fy - iey)
            ix2 = min(w, fx + fw + iex)
            iy2 = min(h, fy + fh + int(fh * inner_expand * 0.5))

            icx = (ix1 + ix2) // 2
            icy = (iy1 + iy2) // 2
            irx = (ix2 - ix1) // 2
            iry = (iy2 - iy1) // 2
            cv2.ellipse(mask, (icx, icy), (irx, iry), 0, 0, 360, face_value, -1)

            # --- Outer ellipse: transition zone (partial protection) ---
            # Prevents ghost faces by protecting face-adjacent area with a softer value
            outer_expand = 0.7
            oex = int(fw * outer_expand)
            oey = int(fh * outer_expand)
            ox1 = max(0, fx - oex)
            oy1 = max(0, fy - oey)
            ox2 = min(w, fx + fw + oex)
            oy2 = min(h, fy + fh + int(fh * outer_expand * 0.3))

            ocx = (ox1 + ox2) // 2
            ocy = (oy1 + oy2) // 2
            orx = (ox2 - ox1) // 2
            ory = (oy2 - oy1) // 2

            # Transition value: halfway between face_value and 255 (full edit)
            transition_value = (face_value + 255) // 2

            # Draw outer ring first (will be overwritten by inner ellipse above)
            outer_mask = np.ones((h, w), dtype=np.uint8) * 255
            cv2.ellipse(outer_mask, (ocx, ocy), (orx, ory), 0, 0, 360, transition_value, -1)
            # Only apply outer where mask is still 255 (don't weaken inner protection)
            mask = np.minimum(mask, outer_mask)

        # Feather the mask edges with a wide gaussian blur for smooth skin tone blending
        # Large kernel + high sigma creates a gradual transition that prevents color discontinuity
        blur_size = max(101, (min(h, w) // 8) | 1)  # scale with image size, ensure odd
        blur_sigma = blur_size // 2
        mask = cv2.GaussianBlur(mask, (blur_size, blur_size), blur_sigma)

        mask_path = os.path.join(WORKING_DIR, f"facemask_{uuid.uuid4().hex[:8]}.png")
        cv2.imwrite(mask_path, mask)
        print(f"[ai-media] Face mask saved: {mask_path}", file=sys.stderr)
        return mask_path

    except ImportError:
        print("[ai-media] OpenCV not installed — face mask unavailable", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[ai-media] Face detection error: {e}", file=sys.stderr)
        return None


# ===========================================================================
# IMAGE EDITING (FLUX.1 Dev + LoRA via ComfyUI API)
# ===========================================================================
def cmd_edit(args):
    """Image editing using FLUX.1 Dev gguf + LoRA via ComfyUI img2img.
    Automatically detects faces and protects them with an inpainting mask.
    """
    ensure_workdir()

    if not ensure_comfyui():
        return {"ok": False, "error": "ComfyUI failed to start automatically. Check ~/start-comfyui.sh"}

    if not args.image or not os.path.exists(args.image):
        return {"ok": False, "error": f"Input image not found: {args.image}"}

    image_path = convert_and_resize(args.image)
    output = args.output or os.path.join(WORKING_DIR, f"edit_{uuid.uuid4().hex[:8]}.png")

    try:
        uploaded_name = comfyui_upload_image(image_path)
        if not uploaded_name:
            return {"ok": False, "error": "Failed to upload image to ComfyUI"}

        denoise = args.denoise if hasattr(args, 'denoise') and args.denoise is not None else 0.45
        steps = args.steps or 15
        seed = args.seed if args.seed is not None else int(time.time()) % (2**32)
        lora = args.lora or FLUX_DEV_LORA
        lora_strength = args.lora_strength if hasattr(args, 'lora_strength') and args.lora_strength else FLUX_DEV_LORA_STRENGTH
        negative_prompt = args.negative_prompt if hasattr(args, 'negative_prompt') and args.negative_prompt else ""

        # Parse extra LoRAs: "file1.safetensors:0.9,file2.safetensors:1.3"
        extra_loras = []
        extra_loras_str = args.extra_loras if hasattr(args, 'extra_loras') and args.extra_loras else FLUX_DEV_EXTRA_LORAS
        if extra_loras_str:
            for entry in extra_loras_str.split(","):
                entry = entry.strip()
                if not entry:
                    continue
                if ":" in entry:
                    name, strength = entry.rsplit(":", 1)
                    extra_loras.append((name.strip(), float(strength)))
                else:
                    extra_loras.append((entry.strip(), 0.8))

        # Face detection & mask (disabled by default — use --face-mask to enable)
        mask_name = None
        use_face_mask = hasattr(args, 'face_mask') and args.face_mask
        face_protect = float(args.face_protect) if hasattr(args, 'face_protect') and args.face_protect is not None else 0.35
        if use_face_mask:
            mask_path = detect_faces_and_create_mask(image_path, face_protect=face_protect)
            if mask_path:
                mask_name = comfyui_upload_image(mask_path)
                if mask_name:
                    print(f"[ai-media] Face mask uploaded: {mask_name}", file=sys.stderr)
                # Cleanup local mask file
                try:
                    os.unlink(mask_path)
                except OSError:
                    pass

        workflow = build_flux_img2img_workflow(
            image_name=uploaded_name,
            prompt=args.prompt,
            steps=steps,
            denoise=denoise,
            seed=seed,
            lora=lora,
            lora_strength=lora_strength,
            mask_name=mask_name,
            negative_prompt=negative_prompt,
            extra_loras=extra_loras,
        )

        mask_info = f", face_mask={mask_name}" if mask_name else ", no_mask"
        extra_info = f", extra_loras={len(extra_loras)}" if extra_loras else ""
        neg_info = f", neg='{negative_prompt[:50]}'" if negative_prompt else ""
        print(f"[ai-media] Editing image with FLUX.1 Dev + LoRA via ComfyUI...", file=sys.stderr)
        print(f"[ai-media] denoise={denoise}, steps={steps}, lora={lora}, scale={lora_strength}{mask_info}{extra_info}{neg_info}", file=sys.stderr)

        t0 = time.time()
        output_files = comfyui_queue_and_wait(workflow)
        elapsed = time.time() - t0

        if not output_files:
            return {"ok": False, "error": "No output files from ComfyUI", "elapsed": round(elapsed, 1)}

        fname = output_files[0].get("filename", "")
        subfolder = output_files[0].get("subfolder", "")
        ftype = output_files[0].get("type", "output")
        out_path = comfyui_download_output(fname, subfolder, ftype)

        if out_path:
            import shutil
            shutil.move(out_path, output)
            return {"ok": True, "path": output, "elapsed": round(elapsed, 1)}

        return {"ok": False, "error": "Could not retrieve image from ComfyUI", "elapsed": round(elapsed, 1)}

    except Exception as e:
        return {"ok": False, "error": str(e)}


def build_flux_img2img_workflow(image_name: str, prompt: str, steps: int = 20,
                                 denoise: float = 0.45, seed: int = 0,
                                 lora: str = "", lora_strength: float = 0.8,
                                 mask_name: str | None = None,
                                 negative_prompt: str = "",
                                 extra_loras: list | None = None) -> dict:
    """Build ComfyUI API workflow for FLUX.1 Dev img2img with LoRA chain.

    LoRA chain: [1] UnetLoaderGGUF → [4] LoRA1 → [14] LoRA2 → [15] LoRA3 → ... → KSampler
    Negative prompt: [8] CLIPTextEncode with negative text → KSampler

    Without mask (standard img2img):
      [1] UnetLoaderGGUF → [4] LoraLoaderModelOnly → [14+] extra LoRAs → [9] KSampler
      [2] DualCLIPLoaderGGUF → [7] CLIPTextEncode(+) → [9]
                              → [8] CLIPTextEncode(-) → [9]
      [3] VAELoader → [6] VAEEncode ← [5] LoadImage → [9] latent
      [9] KSampler → [10] VAEDecode → [11] SaveImage

    With face mask (inpainting - face protected):
      Same as above, plus:
      [12] LoadImageMask  → mask
      [13] SetLatentNoiseMask ← latent[6] + mask[12] → [9] KSampler
      KSampler reads masked latent: black regions (face) = no change
    """
    workflow = {
        "1": {
            "class_type": "UnetLoaderGGUF",
            "inputs": {
                "unet_name": FLUX_DEV_UNET,
            }
        },
        "2": {
            "class_type": "DualCLIPLoaderGGUF",
            "inputs": {
                "clip_name1": FLUX_DEV_CLIP_L,
                "clip_name2": FLUX_DEV_T5,
                "type": "flux",
            }
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": FLUX_DEV_VAE,
            }
        },
        "4": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": ["1", 0],
                "lora_name": lora,
                "strength_model": lora_strength,
            }
        },
        "5": {
            "class_type": "LoadImage",
            "inputs": {
                "image": image_name,
            }
        },
        "6": {
            "class_type": "VAEEncode",
            "inputs": {
                "pixels": ["5", 0],
                "vae": ["3", 0],
            }
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": prompt,
                "clip": ["2", 0],
            }
        },
        "8": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": negative_prompt,
                "clip": ["2", 0],
            }
        },
        "9": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["4", 0],  # will be updated to last LoRA in chain
                "positive": ["7", 0],
                "negative": ["8", 0],
                "latent_image": ["6", 0],  # will be overridden if mask exists
                "seed": seed,
                "steps": steps,
                "cfg": 2.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": denoise,
            }
        },
        "10": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["9", 0],
                "vae": ["3", 0],
            }
        },
        "11": {
            "class_type": "SaveImage",
            "inputs": {
                "images": ["10", 0],
                "filename_prefix": "flux_edit",
            }
        },
    }

    # Chain extra LoRAs after the primary LoRA (node 4)
    # Each LoRA takes model output from previous LoRA
    last_model_node = "4"
    if extra_loras:
        node_id = 14  # start extra LoRA nodes from 14
        for lora_name, strength in extra_loras:
            workflow[str(node_id)] = {
                "class_type": "LoraLoaderModelOnly",
                "inputs": {
                    "model": [last_model_node, 0],
                    "lora_name": lora_name,
                    "strength_model": strength,
                }
            }
            last_model_node = str(node_id)
            node_id += 1
        # Point KSampler to the last LoRA in the chain
        workflow["9"]["inputs"]["model"] = [last_model_node, 0]

    # Add face mask nodes if mask is provided
    if mask_name:
        # [12] Load the mask image (white=edit, black=protect)
        workflow["12"] = {
            "class_type": "LoadImageMask",
            "inputs": {
                "image": mask_name,
                "channel": "red",
            }
        }
        # [13] Apply mask to latent — KSampler only denoises white regions
        workflow["13"] = {
            "class_type": "SetLatentNoiseMask",
            "inputs": {
                "samples": ["6", 0],
                "mask": ["12", 0],
            }
        }
        # Redirect KSampler to use masked latent
        workflow["9"]["inputs"]["latent_image"] = ["13", 0]

    return workflow


# ===========================================================================
# IMAGE OUTPAINTING (FLUX.1 Dev + LoRA via ComfyUI API)
# ===========================================================================
def cmd_outpaint(args):
    """Outpainting using FLUX.1 Dev gguf + LoRA via ComfyUI.
    Extends image in specified direction (default: bottom) and generates content.
    """
    ensure_workdir()

    if not ensure_comfyui():
        return {"ok": False, "error": "ComfyUI failed to start automatically. Check ~/start-comfyui.sh"}

    if not args.image or not os.path.exists(args.image):
        return {"ok": False, "error": f"Input image not found: {args.image}"}

    image_path = convert_and_resize(args.image)
    output = args.output or os.path.join(WORKING_DIR, f"outpaint_{uuid.uuid4().hex[:8]}.png")

    try:
        uploaded_name = comfyui_upload_image(image_path)
        if not uploaded_name:
            return {"ok": False, "error": "Failed to upload image to ComfyUI"}

        denoise = args.denoise if hasattr(args, 'denoise') and args.denoise is not None else 1.0
        steps = args.steps if hasattr(args, 'steps') and args.steps is not None else 25
        seed = args.seed if args.seed is not None else int(time.time()) % (2**32)
        lora = args.lora or FLUX_DEV_LORA
        lora_strength = args.lora_strength if hasattr(args, 'lora_strength') and args.lora_strength else FLUX_DEV_LORA_STRENGTH
        negative_prompt = args.negative_prompt if hasattr(args, 'negative_prompt') and args.negative_prompt else ""

        # Direction and amount of extension
        direction = args.direction if hasattr(args, 'direction') and args.direction else "bottom"
        expand_pixels = args.expand if hasattr(args, 'expand') and args.expand else 0
        feathering = args.feathering if hasattr(args, 'feathering') and args.feathering else 128

        # Auto-calculate expand amount if not specified
        if expand_pixels <= 0:
            from PIL import Image
            img = Image.open(image_path)
            w, h = img.size
            if direction in ("bottom", "top"):
                # Extend by ~75% of the shorter dimension, capped for quality
                expand_pixels = int(min(w, h) * 0.75)
                expand_pixels = min(expand_pixels, 768)  # cap to avoid grey fill
                expand_pixels = max(expand_pixels, 256)   # minimum useful expansion
                expand_pixels = (expand_pixels // 8) * 8
            else:
                expand_pixels = int(min(w, h) * 0.5)
                expand_pixels = min(expand_pixels, 768)
                expand_pixels = max(expand_pixels, 256)
                expand_pixels = (expand_pixels // 8) * 8

        print(f"[ai-media] Outpaint direction={direction}, expand={expand_pixels}px, feathering={feathering}", file=sys.stderr)

        # Parse extra LoRAs
        extra_loras = []
        extra_loras_str = args.extra_loras if hasattr(args, 'extra_loras') and args.extra_loras else FLUX_DEV_EXTRA_LORAS
        if extra_loras_str:
            for entry in extra_loras_str.split(","):
                entry = entry.strip()
                if not entry:
                    continue
                if ":" in entry:
                    name, strength = entry.rsplit(":", 1)
                    extra_loras.append((name.strip(), float(strength)))
                else:
                    extra_loras.append((entry.strip(), 0.8))

        workflow = build_flux_outpaint_workflow(
            image_name=uploaded_name,
            prompt=args.prompt,
            steps=steps,
            denoise=denoise,
            seed=seed,
            lora=lora,
            lora_strength=lora_strength,
            negative_prompt=negative_prompt,
            extra_loras=extra_loras,
            direction=direction,
            expand_pixels=expand_pixels,
            feathering=feathering,
        )

        extra_info = f", extra_loras={len(extra_loras)}" if extra_loras else ""
        neg_info = f", neg='{negative_prompt[:50]}'" if negative_prompt else ""
        print(f"[ai-media] Outpainting with FLUX.1 Dev + LoRA via ComfyUI...", file=sys.stderr)
        print(f"[ai-media] denoise={denoise}, steps={steps}, lora={lora}, {direction}={expand_pixels}px{extra_info}{neg_info}", file=sys.stderr)

        t0 = time.time()
        output_files = comfyui_queue_and_wait(workflow)
        elapsed = time.time() - t0

        if not output_files:
            return {"ok": False, "error": "No output files from ComfyUI", "elapsed": round(elapsed, 1)}

        fname = output_files[0].get("filename", "")
        subfolder = output_files[0].get("subfolder", "")
        ftype = output_files[0].get("type", "output")
        out_path = comfyui_download_output(fname, subfolder, ftype)

        if out_path:
            import shutil
            # Post-process: blend original image back into result to eliminate boundary
            try:
                from PIL import Image, ImageFilter
                original = Image.open(image_path).convert("RGBA")
                result_img = Image.open(out_path).convert("RGBA")
                ow, oh = original.size
                rw, rh = result_img.size

                # Determine where original image sits within the result
                if direction == "bottom":
                    ox, oy = 0, 0
                elif direction == "top":
                    ox, oy = 0, rh - oh
                elif direction == "right":
                    ox, oy = 0, 0
                elif direction == "left":
                    ox, oy = rw - ow, 0
                else:
                    ox, oy = 0, 0

                # Create alpha mask for blending: original area = opaque, fade at boundary
                blend_zone = 128  # pixels of gradient blending
                mask = Image.new("L", (rw, rh), 0)
                # Fill original region as white (opaque = use original)
                mask.paste(255, (ox, oy, ox + ow, oy + oh))
                # Blur the mask to create smooth gradient at boundary
                mask = mask.filter(ImageFilter.GaussianBlur(radius=blend_zone))

                # Composite: where mask is white use original, where black use generated
                canvas = Image.new("RGBA", (rw, rh), (0, 0, 0, 0))
                canvas.paste(original, (ox, oy))
                blended = Image.composite(canvas, result_img, mask)
                blended = blended.convert("RGB")
                blended.save(out_path, "PNG")
                print(f"[ai-media] Post-blend applied (blend_zone={blend_zone}px)", file=sys.stderr)
            except Exception as blend_err:
                print(f"[ai-media] Post-blend skipped: {blend_err}", file=sys.stderr)

            shutil.move(out_path, output)
            return {"ok": True, "path": output, "elapsed": round(elapsed, 1)}

        return {"ok": False, "error": "Could not retrieve image from ComfyUI", "elapsed": round(elapsed, 1)}

    except Exception as e:
        return {"ok": False, "error": str(e)}


def build_flux_outpaint_workflow(image_name: str, prompt: str, steps: int = 20,
                                  denoise: float = 0.85, seed: int = 0,
                                  lora: str = "", lora_strength: float = 0.8,
                                  negative_prompt: str = "",
                                  extra_loras: list | None = None,
                                  direction: str = "bottom",
                                  expand_pixels: int = 512,
                                  feathering: int = 40) -> dict:
    """Build ComfyUI API workflow for FLUX.1 Dev outpainting.

    Uses ImagePadForOutpaint to extend the image and create a mask,
    then VAEEncodeForInpaint to properly encode the masked region with
    noise fill (avoids grey fill issue with SetLatentNoiseMask on FLUX).

    Node graph:
      [1] UnetLoaderGGUF
      [2] DualCLIPLoaderGGUF
      [3] VAELoader
      [4] LoraLoaderModelOnly ← model[1]
      [5] LoadImage
      [20] ImagePadForOutpaint ← image[5], direction padding
      [6] VAEEncodeForInpaint ← padded_image[20], mask[20], vae[3]
      [7] CLIPTextEncode(+) ← clip[2]
      [8] CLIPTextEncode(-) ← clip[2]
      [9] KSampler ← model[4+], pos[7], neg[8], latent[6]
      [10] VAEDecode ← samples[9], vae[3]
      [11] SaveImage ← images[10]
    """
    # Calculate padding per direction
    pad = {"left": 0, "top": 0, "right": 0, "bottom": 0}
    if direction in pad:
        pad[direction] = expand_pixels
    else:
        pad["bottom"] = expand_pixels

    workflow = {
        "1": {
            "class_type": "UnetLoaderGGUF",
            "inputs": {
                "unet_name": FLUX_DEV_UNET,
            }
        },
        "2": {
            "class_type": "DualCLIPLoaderGGUF",
            "inputs": {
                "clip_name1": FLUX_DEV_CLIP_L,
                "clip_name2": FLUX_DEV_T5,
                "type": "flux",
            }
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": FLUX_DEV_VAE,
            }
        },
        "4": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": ["1", 0],
                "lora_name": lora,
                "strength_model": lora_strength,
            }
        },
        "5": {
            "class_type": "LoadImage",
            "inputs": {
                "image": image_name,
            }
        },
        "20": {
            "class_type": "ImagePadForOutpaint",
            "inputs": {
                "image": ["5", 0],
                "left": pad["left"],
                "top": pad["top"],
                "right": pad["right"],
                "bottom": pad["bottom"],
                "feathering": feathering,
            }
        },
        "6": {
            "class_type": "VAEEncodeForInpaint",
            "inputs": {
                "pixels": ["20", 0],  # padded image
                "vae": ["3", 0],
                "mask": ["20", 1],  # mask from ImagePadForOutpaint
                "grow_mask_by": 6,
            }
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": prompt,
                "clip": ["2", 0],
            }
        },
        "8": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": negative_prompt,
                "clip": ["2", 0],
            }
        },
        "9": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["4", 0],
                "positive": ["7", 0],
                "negative": ["8", 0],
                "latent_image": ["6", 0],
                "seed": seed,
                "steps": steps,
                "cfg": 3.5,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": denoise,
            }
        },
        "10": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["9", 0],
                "vae": ["3", 0],
            }
        },
        "11": {
            "class_type": "SaveImage",
            "inputs": {
                "images": ["10", 0],
                "filename_prefix": "flux_outpaint",
            }
        },
    }

    # Chain extra LoRAs
    last_model_node = "4"
    if extra_loras:
        node_id = 14
        for lora_name, strength in extra_loras:
            # Skip node IDs already used (20)
            while str(node_id) in workflow:
                node_id += 1
            workflow[str(node_id)] = {
                "class_type": "LoraLoaderModelOnly",
                "inputs": {
                    "model": [last_model_node, 0],
                    "lora_name": lora_name,
                    "strength_model": strength,
                }
            }
            last_model_node = str(node_id)
            node_id += 1
        workflow["9"]["inputs"]["model"] = [last_model_node, 0]

    return workflow


# ===========================================================================
# VIDEO GENERATION (Wan2.2 TI2V-5B via ComfyUI API)
# ===========================================================================
def cmd_animate(args):
    """Image-to-video or text-to-video using Wan2.2 TI2V-5B."""
    ensure_workdir()

    if not ensure_comfyui():
        return {"ok": False, "error": "ComfyUI failed to start automatically. Check ~/start-comfyui.sh"}

    output = args.output or os.path.join(WORKING_DIR, f"video_{uuid.uuid4().hex[:8]}.mp4")

    width = args.width or 832
    height = args.height or 480
    frames = args.frames or 33
    steps = args.steps or 30

    if args.image and os.path.exists(args.image):
        # Image-to-Video
        image_path = convert_and_resize(args.image)
        uploaded_name = comfyui_upload_image(image_path)
        if not uploaded_name:
            return {"ok": False, "error": "Failed to upload image to ComfyUI"}
        workflow = build_wan22_i2v_workflow(
            prompt=args.prompt,
            image_name=uploaded_name,
            width=width, height=height,
            num_frames=frames, steps=steps,
            seed=args.seed,
        )
        mode = "I2V"
    else:
        # Text-to-Video
        workflow = build_wan22_t2v_workflow(
            prompt=args.prompt,
            width=width, height=height,
            num_frames=frames, steps=steps,
            seed=args.seed,
        )
        mode = "T2V"

    print(f"[ai-media] {mode}: {width}x{height}, {frames} frames, {steps} steps, shift={WAN22_SHIFT}", file=sys.stderr)
    t0 = time.time()

    try:
        output_files = comfyui_queue_and_wait(workflow)
    except Exception as e:
        elapsed = time.time() - t0
        return {"ok": False, "error": str(e), "elapsed": round(elapsed, 1)}

    elapsed = time.time() - t0

    if not output_files:
        return {"ok": False, "error": "No output files from ComfyUI", "elapsed": round(elapsed, 1)}

    # Find video output
    final_output = None
    for f_info in output_files:
        fname = f_info.get("filename", "")
        subfolder = f_info.get("subfolder", "")
        ftype = f_info.get("type", "output")

        out_path = comfyui_download_output(fname, subfolder, ftype)
        if out_path:
            if fname.endswith((".mp4", ".webm", ".gif")):
                final_output = out_path
                break
            elif not final_output:
                final_output = out_path

    if not final_output:
        return {"ok": False, "error": "Could not retrieve video from ComfyUI", "elapsed": round(elapsed, 1)}

    if final_output != output:
        import shutil
        shutil.move(final_output, output)
        final_output = output

    return {"ok": True, "path": final_output, "elapsed": round(elapsed, 1)}


# ===========================================================================
# ComfyUI API helpers
# ===========================================================================
def comfyui_is_running() -> bool:
    try:
        req = urllib.request.urlopen(f"{COMFYUI_URL}/system_stats", timeout=3)
        return req.status == 200
    except Exception:
        return False


def ensure_comfyui() -> bool:
    """ComfyUIが起動していなければバックグラウンドで起動し、準備完了まで待つ。"""
    if comfyui_is_running():
        return True

    start_script = os.path.expanduser("~/start-comfyui.sh")
    if not os.path.exists(start_script):
        print("[ai-media] start-comfyui.sh not found", file=sys.stderr)
        return False

    print("[ai-media] ComfyUI not running — starting automatically...", file=sys.stderr)
    subprocess.Popen(
        ["bash", start_script],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )

    # 最大120秒待機
    for i in range(60):
        time.sleep(2)
        if comfyui_is_running():
            print(f"[ai-media] ComfyUI started ({(i+1)*2}s)", file=sys.stderr)
            return True
        if i % 5 == 4:
            print(f"[ai-media] Waiting for ComfyUI... ({(i+1)*2}s)", file=sys.stderr)

    print("[ai-media] ComfyUI failed to start within 120s", file=sys.stderr)
    return False


def comfyui_upload_image(image_path: str) -> str:
    """Upload image to ComfyUI input folder. Returns the filename on server."""
    import mimetypes
    boundary = uuid.uuid4().hex
    filename = os.path.basename(image_path)

    with open(image_path, "rb") as f:
        file_data = f.read()

    content_type = mimetypes.guess_type(image_path)[0] or "image/png"

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode() + file_data + f"\r\n--{boundary}\r\n".encode() + (
        f'Content-Disposition: form-data; name="type"\r\n\r\ninput\r\n'
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n'
        f"--{boundary}--\r\n"
    ).encode()

    req = urllib.request.Request(
        f"{COMFYUI_URL}/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST"
    )
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        result = json.loads(resp.read())
        return result.get("name", filename)
    except Exception as e:
        print(f"[ai-media] Upload failed: {e}", file=sys.stderr)
        return None


def comfyui_queue_and_wait(workflow: dict, timeout: int = 2400) -> list:
    """Queue workflow and wait for completion. Returns list of output file infos."""
    import websocket

    client_id = str(uuid.uuid4())

    ws = websocket.WebSocket()
    ws.settimeout(timeout)
    ws_url = COMFYUI_URL.replace("http://", "ws://").replace("https://", "wss://")
    ws.connect(f"{ws_url}/ws?clientId={client_id}")

    payload = json.dumps({"prompt": workflow, "client_id": client_id}).encode()
    req = urllib.request.Request(
        f"{COMFYUI_URL}/prompt",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    resp = urllib.request.urlopen(req, timeout=30)
    result = json.loads(resp.read())

    if "error" in result:
        ws.close()
        raise Exception(f"ComfyUI error: {result['error']}")

    prompt_id = result["prompt_id"]
    print(f"[ai-media] Queued prompt: {prompt_id}", file=sys.stderr)

    start = time.time()
    while time.time() - start < timeout:
        try:
            msg = ws.recv()
            if isinstance(msg, str):
                data = json.loads(msg)
                msg_type = data.get("type", "")

                if msg_type == "progress":
                    d = data.get("data", {})
                    pct = d.get("value", 0) / max(d.get("max", 1), 1) * 100
                    print(f"\r[ai-media] Progress: {pct:.0f}%", end="", file=sys.stderr)

                elif msg_type == "executed":
                    d = data.get("data", {})
                    if d.get("prompt_id") == prompt_id:
                        print(f"\n[ai-media] Execution complete!", file=sys.stderr)
                        ws.close()
                        return comfyui_get_outputs(prompt_id)

                elif msg_type == "execution_error":
                    d = data.get("data", {})
                    if d.get("prompt_id") == prompt_id:
                        ws.close()
                        raise Exception(f"Execution error: {d.get('exception_message', 'unknown')}")
        except websocket.WebSocketTimeoutException:
            continue

    ws.close()
    raise Exception(f"Timeout after {timeout}s")


def comfyui_get_outputs(prompt_id: str) -> list:
    """Get output files from completed prompt."""
    url = f"{COMFYUI_URL}/history/{prompt_id}"
    resp = urllib.request.urlopen(url, timeout=10)
    history = json.loads(resp.read())

    outputs = []
    if prompt_id in history:
        for node_id, node_output in history[prompt_id].get("outputs", {}).items():
            if "gifs" in node_output:
                outputs.extend(node_output["gifs"])
            if "images" in node_output:
                outputs.extend(node_output["images"])
            if "videos" in node_output:
                outputs.extend(node_output["videos"])
    return outputs


def comfyui_download_output(filename: str, subfolder: str = "", folder_type: str = "output") -> str:
    """Download output file from ComfyUI."""
    params = urllib.parse.urlencode({"filename": filename, "subfolder": subfolder, "type": folder_type})
    url = f"{COMFYUI_URL}/view?{params}"
    try:
        resp = urllib.request.urlopen(url, timeout=60)
        out_path = os.path.join(WORKING_DIR, filename)
        with open(out_path, "wb") as f:
            f.write(resp.read())
        return out_path
    except Exception as e:
        print(f"[ai-media] Download failed: {e}", file=sys.stderr)
        return None


# ===========================================================================
# Wan2.2 TI2V-5B Workflow builders (all 6 bugs fixed)
# ===========================================================================
# Corrected architecture from official ComfyUI 5B template:
#
# T2V mode (10 nodes):
#   [1] UNETLoader → [2] ModelSamplingSD3(shift) → [8] KSampler
#   [3] CLIPLoaderGGUF → [5] CLIPTextEncode(prompt)  → [8] KSampler.positive
#                      → [7] CLIPTextEncode("")       → [8] KSampler.negative
#   [4] VAELoader → [6] Wan22ImageToVideoLatent(no start_image) → [8] KSampler.latent
#                 → [9] VAEDecode ← [8] KSampler.output
#                    → [10] VHS_VideoCombine
#
# I2V mode (11 nodes):
#   Same as T2V, plus: [6] LoadImage → [7] Wan22ImageToVideoLatent.start_image
#
# Key corrections:
#   BUG1: EmptyWan22LatentVideo → Wan22ImageToVideoLatent (correct node)
#   BUG2: ModelSamplingSD3 REQUIRED between UNETLoader and KSampler
#   BUG3: 5B does NOT use CLIPVision (CLIPVisionLoader/Encode/WanImageToVideoCond = 14B only)
#   BUG4: Resolution 480x480 → 832x480 default (720p tuned model)
#   BUG5: KSampler params: cfg=3.5, euler, simple (not cfg=5.0, uni_pc_bh2, normal)
#   BUG6: fp8 text encoder → GGUF (fp8 crashes on MPS: Float8_e4m3fn unsupported)
# ===========================================================================

def _unet_loader_node():
    """UNET model loader node."""
    if WAN22_USE_GGUF_UNET:
        return {
            "class_type": "UnetLoaderGGUF",
            "inputs": {
                "unet_name": WAN22_GGUF_UNET_MODEL
            }
        }
    else:
        return {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": WAN22_MODEL,
                "weight_dtype": "default"
            }
        }


def _model_sampling_node(model_source: str):
    """ModelSamplingSD3 node — REQUIRED for Wan2.2 (BUG2 fix).
    Applies shift parameter to the diffusion model's noise schedule.
    Without this, generation quality degrades significantly or may crash.
    Default shift=3.0, typical range 3.0-5.0 for Wan models.
    """
    return {
        "class_type": "ModelSamplingSD3",
        "inputs": {
            "shift": WAN22_SHIFT,
            "model": [model_source, 0]
        }
    }


def _text_encoder_node():
    """Text encoder loader node (BUG6 fix).
    GGUF default because fp8 (Float8_e4m3fn) is INCOMPATIBLE with Apple MPS.
    Error: 'Trying to convert Float8_e4m3fn to the MPS backend but it does not
    have support for that dtype' (GitHub ComfyUI #9255, #10292)
    """
    if WAN22_TEXT_ENCODER_TYPE == "gguf":
        return {
            "class_type": "CLIPLoaderGGUF",
            "inputs": {
                "clip_name": WAN22_CLIP_GGUF,
                "type": "wan"
            }
        }
    else:
        return {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": WAN22_CLIP_FP16,
                "type": "wan"
            }
        }


def build_wan22_t2v_workflow(prompt: str, width: int = 832, height: int = 480,
                             num_frames: int = 33, steps: int = 30,
                             seed: int = None) -> dict:
    """Build Wan2.2 TI2V-5B text-to-video workflow JSON.

    Node graph (numeric IDs only for ComfyUI API compatibility):
      1   UNETLoader (fp16)
      2   ModelSamplingSD3 (shift=3.0) ← model from [1]
      3   CLIPLoaderGGUF (GGUF text encoder)
      4   VAELoader
      5   CLIPTextEncode (positive) ← clip from [3]
      6   Wan22ImageToVideoLatent (no start_image = T2V) ← vae from [4]
      7   CLIPTextEncode (negative="") ← clip from [3]
      8   KSampler ← model[2], pos[5], neg[7], latent[6]
      9   VAEDecode ← samples[8], vae[4]
      10  VHS_VideoCombine ← images[9]
    """
    if seed is None:
        import random
        seed = random.randint(0, 2**32 - 1)

    return {
        "1": _unet_loader_node(),
        "2": _model_sampling_node("1"),
        "3": _text_encoder_node(),
        "4": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": WAN22_VAE}
        },
        "5": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": prompt, "clip": ["3", 0]}
        },
        "6": {
            "class_type": "Wan22ImageToVideoLatent",
            "inputs": {
                "width": width,
                "height": height,
                "length": num_frames,
                "batch_size": 1,
                "vae": ["4", 0]
            }
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "", "clip": ["3", 0]}
        },
        "8": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": 3.5,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0,
                "model": ["2", 0],
                "positive": ["5", 0],
                "negative": ["7", 0],
                "latent_image": ["6", 0]
            }
        },
        "9": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["8", 0], "vae": ["4", 0]}
        },
        "10": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "frame_rate": 24,
                "loop_count": 0,
                "filename_prefix": "wan22_t2v",
                "format": "video/h264-mp4",
                "save_output": True,
                "pingpong": False,
                "pix_fmt": "yuv420p",
                "crf": 19,
                "save_metadata": True,
                "trim_to_audio": False,
                "images": ["9", 0]
            }
        }
    }


def build_wan22_i2v_workflow(prompt: str, image_name: str, width: int = 832,
                             height: int = 480, num_frames: int = 33,
                             steps: int = 30, seed: int = None) -> dict:
    """Build Wan2.2 TI2V-5B image-to-video workflow JSON.

    Node graph (numeric IDs only for ComfyUI API compatibility):
      1   UNETLoader (fp16)
      2   ModelSamplingSD3 (shift=3.0) ← model from [1]
      3   CLIPLoaderGGUF (GGUF text encoder)
      4   VAELoader
      5   CLIPTextEncode (positive) ← clip from [3]
      6   LoadImage (start frame)
      7   Wan22ImageToVideoLatent (with start_image) ← vae[4], start_image[6]
      8   CLIPTextEncode (negative="") ← clip from [3]
      9   KSampler ← model[2], pos[5], neg[8], latent[7]
      10  VAEDecode ← samples[9], vae[4]
      11  VHS_VideoCombine ← images[10]

    NOTE: 5B model does NOT use CLIPVision (BUG3 fix).
    CLIPVisionLoader / CLIPVisionEncode / WanImageToVideoCond are 14B-only.
    The 5B model takes start_image directly via Wan22ImageToVideoLatent.
    """
    if seed is None:
        import random
        seed = random.randint(0, 2**32 - 1)

    return {
        "1": _unet_loader_node(),
        "2": _model_sampling_node("1"),
        "3": _text_encoder_node(),
        "4": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": WAN22_VAE}
        },
        "5": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": prompt, "clip": ["3", 0]}
        },
        "6": {
            "class_type": "LoadImage",
            "inputs": {"image": image_name}
        },
        "7": {
            "class_type": "Wan22ImageToVideoLatent",
            "inputs": {
                "width": width,
                "height": height,
                "length": num_frames,
                "batch_size": 1,
                "vae": ["4", 0],
                "start_image": ["6", 0]
            }
        },
        "8": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "", "clip": ["3", 0]}
        },
        "9": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": 3.5,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0,
                "model": ["2", 0],
                "positive": ["5", 0],
                "negative": ["8", 0],
                "latent_image": ["7", 0]
            }
        },
        "10": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["9", 0], "vae": ["4", 0]}
        },
        "11": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "frame_rate": 24,
                "loop_count": 0,
                "filename_prefix": "wan22_i2v",
                "format": "video/h264-mp4",
                "save_output": True,
                "pingpong": False,
                "pix_fmt": "yuv420p",
                "crf": 19,
                "save_metadata": True,
                "trim_to_audio": False,
                "images": ["10", 0]
            }
        }
    }


# ===========================================================================
# Utility
# ===========================================================================
def find_output_file(expected_path: str, workdir: str) -> str:
    """mflux sometimes appends suffix. Find the actual output."""
    if os.path.exists(expected_path):
        return expected_path

    d = os.path.dirname(expected_path)
    if not os.path.isdir(d):
        d = workdir

    candidates = []
    for f in os.listdir(d):
        fpath = os.path.join(d, f)
        if os.path.isfile(fpath) and f.endswith((".png", ".jpg", ".jpeg")):
            mtime = os.path.getmtime(fpath)
            if time.time() - mtime < 600:
                candidates.append((mtime, fpath))

    if candidates:
        candidates.sort(reverse=True)
        return candidates[0][1]

    return expected_path


# ===========================================================================
# CLI
# ===========================================================================
def main():
    parser = argparse.ArgumentParser(description="AI Media Engine for JARVIS")
    sub = parser.add_subparsers(dest="command", required=True)

    # generate
    p_gen = sub.add_parser("generate", help="Text-to-image (Z-Image-Turbo)")
    p_gen.add_argument("--prompt", required=True)
    p_gen.add_argument("--output", default=None)
    p_gen.add_argument("--width", type=int, default=1024)
    p_gen.add_argument("--height", type=int, default=1024)
    p_gen.add_argument("--steps", type=int, default=9)
    p_gen.add_argument("--quantize", type=int, default=8)
    p_gen.add_argument("--seed", type=int, default=None)

    # edit
    p_edit = sub.add_parser("edit", help="Image editing (FLUX.1 Dev + LoRA via ComfyUI)")
    p_edit.add_argument("--image", required=True)
    p_edit.add_argument("--prompt", required=True)
    p_edit.add_argument("--output", default=None)
    p_edit.add_argument("--steps", type=int, default=15)
    p_edit.add_argument("--denoise", type=float, default=None,
                         help="Denoise strength (0.0=no change, 1.0=full regenerate, default 0.85)")
    p_edit.add_argument("--seed", type=int, default=None)
    p_edit.add_argument("--lora", default=None, help="LoRA filename (in ComfyUI loras dir)")
    p_edit.add_argument("--lora-strength", type=float, default=None)
    p_edit.add_argument("--extra-loras", default=None,
                         help="Extra LoRAs chain: 'file1.safetensors:0.9,file2.safetensors:1.3'")
    p_edit.add_argument("--negative-prompt", default=None,
                         help="Negative prompt (what to avoid in generation)")
    p_edit.add_argument("--face-mask", action="store_true",
                         help="Enable automatic face protection mask (disabled by default)")
    p_edit.add_argument("--face-protect", type=float, default=None,
                         help="Face protection level: 0.0=no protect, 1.0=full protect (default 0.35)")

    # outpaint
    p_outpaint = sub.add_parser("outpaint", help="Image outpainting (FLUX.1 Dev + LoRA via ComfyUI)")
    p_outpaint.add_argument("--image", required=True)
    p_outpaint.add_argument("--prompt", required=True)
    p_outpaint.add_argument("--output", default=None)
    p_outpaint.add_argument("--steps", type=int, default=25,
                             help="Sampling steps (default 25)")
    p_outpaint.add_argument("--denoise", type=float, default=None,
                             help="Denoise strength (default 0.85)")
    p_outpaint.add_argument("--seed", type=int, default=None)
    p_outpaint.add_argument("--lora", default=None)
    p_outpaint.add_argument("--lora-strength", type=float, default=None)
    p_outpaint.add_argument("--extra-loras", default=None)
    p_outpaint.add_argument("--negative-prompt", default=None)
    p_outpaint.add_argument("--direction", default="bottom",
                             choices=["bottom", "top", "left", "right"],
                             help="Direction to extend (default: bottom)")
    p_outpaint.add_argument("--expand", type=int, default=0,
                             help="Pixels to expand (0=auto-calculate for full body)")
    p_outpaint.add_argument("--feathering", type=int, default=128,
                             help="Feathering at boundary (default 128)")

    # animate — 832x480 default, 240 frames (~10s at 24fps)
    p_anim = sub.add_parser("animate", help="Video generation (Wan2.2 TI2V-5B)")
    p_anim.add_argument("--image", default=None, help="Input image for I2V (omit for T2V)")
    p_anim.add_argument("--prompt", required=True)
    p_anim.add_argument("--output", default=None)
    p_anim.add_argument("--width", type=int, default=832,
                         help="Width (default 832, recommended 1280)")
    p_anim.add_argument("--height", type=int, default=480,
                         help="Height (default 480, recommended 704)")
    p_anim.add_argument("--frames", type=int, default=240,
                         help="Frames (33=~1.4s, 81=~3.4s, 121=~5s, 240=~10s at 24fps)")
    p_anim.add_argument("--steps", type=int, default=30)
    p_anim.add_argument("--seed", type=int, default=None)

    # status
    sub.add_parser("status", help="Check system status")

    args = parser.parse_args()

    if args.command == "status":
        result = check_status()
    elif args.command == "generate":
        result = cmd_generate(args)
    elif args.command == "edit":
        result = cmd_edit(args)
    elif args.command == "outpaint":
        result = cmd_outpaint(args)
    elif args.command == "animate":
        result = cmd_animate(args)

    print(json.dumps(result, ensure_ascii=False))


def check_status():
    """Check what's available."""
    status = {
        "mflux_installed": False,
        "comfyui_running": False,
        "mflux_venv": os.path.exists(MFLUX_VENV),
        "comfyui_dir": os.path.exists(COMFYUI_DIR),
        "wan22_config": {
            "text_encoder": WAN22_TEXT_ENCODER_TYPE,
            "unet": "gguf" if WAN22_USE_GGUF_UNET else "fp16",
            "shift": WAN22_SHIFT,
        },
    }

    try:
        r = subprocess.run([get_mflux_bin("mflux-generate-z-image-turbo"), "--help"],
                           capture_output=True, text=True, timeout=5)
        status["mflux_installed"] = r.returncode == 0
    except Exception:
        pass

    status["comfyui_running"] = comfyui_is_running()

    # Check model files
    models_dir = os.path.join(COMFYUI_DIR, "models")
    status["models"] = {
        "unet_fp16": os.path.exists(os.path.join(models_dir, "diffusion_models", WAN22_MODEL)),
        "text_encoder_gguf": os.path.exists(os.path.join(models_dir, "text_encoders", WAN22_CLIP_GGUF)),
        "text_encoder_fp16": os.path.exists(os.path.join(models_dir, "text_encoders", WAN22_CLIP_FP16)),
        "vae": os.path.exists(os.path.join(models_dir, "vae", WAN22_VAE)),
    }

    return status


if __name__ == "__main__":
    main()
