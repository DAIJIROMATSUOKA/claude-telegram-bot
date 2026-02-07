#!/usr/bin/env python3
"""
AI Image Generation Wrapper
Handles: text-to-image (mflux/FLUX) + segment-edit (CLIPSeg + SDXL inpaint)
"""

import sys
import json
import subprocess
import os
import time
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

MODEL_DIR = os.path.expanduser("~/ai-models")
OUTPUT_DIR = "/tmp/ai-images"

os.makedirs(OUTPUT_DIR, exist_ok=True)


def generate_image(prompt, model="schnell", steps=4, width=1024, height=1024, quantize=8):
    """Text-to-image with mflux/FLUX"""
    output = os.path.join(OUTPUT_DIR, f"gen_{int(time.time())}.png")

    model_path = os.path.join(MODEL_DIR, f"flux-{model}")
    if not os.path.exists(model_path):
        if model == "schnell":
            model_path = "/tmp/flux-model"
        else:
            model_path = "/tmp/flux-dev-model"

    cmd = [
        "mflux-generate",
        "--model", model_path,
        "--prompt", prompt,
        "--steps", str(steps),
        "--width", str(width),
        "--height", str(height),
        "--output", output,
        "--quantize", str(quantize),
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    
    if result.returncode != 0:
        return {"error": result.stderr}
    
    # Convert PNG to JPEG for smaller file size
    try:
        from PIL import Image as PILImg
        jpg_output = output.replace(".png", ".jpg")
        PILImg.open(output).convert("RGB").save(jpg_output, "JPEG", quality=92)
        os.remove(output)
        output = jpg_output
    except: pass
    return {"output": output}


def segment_edit(input_image, target, prompt, invert=False, debug=False):
    """CLIPSeg mask + SDXL inpainting"""
    import torch
    import numpy as np
    from PIL import Image, ImageFilter
    from transformers import CLIPSegProcessor, CLIPSegForImageSegmentation
    from diffusers import StableDiffusionXLInpaintPipeline
    
    timestamp = int(time.time())
    output = os.path.join(OUTPUT_DIR, f"edit_{timestamp}.png")
    mask_output = os.path.join(OUTPUT_DIR, f"mask_{timestamp}.png")
    
    # Load image
    try:
        img = Image.open(input_image).convert("RGB")
    except Exception as e:
        return {"error": f"Failed to open image: {e}"}
    
    img = img.resize((1024, 1024))
    
    # CLIPSeg mask generation
    print(f"[CLIPSeg] Segmenting: {target}")
    proc = CLIPSegProcessor.from_pretrained("CIDAS/clipseg-rd64-refined")
    model = CLIPSegForImageSegmentation.from_pretrained("CIDAS/clipseg-rd64-refined")
    
    inputs = proc(text=[target], images=[img], return_tensors="pt", padding=True)
    with torch.no_grad():
        outputs = model(**inputs)
    
    mask = torch.sigmoid(outputs.logits[0]).numpy()
    
    # Resize mask to 1024x1024
    mask_img = Image.fromarray((mask * 255).astype(np.uint8))
    mask_img = mask_img.resize((1024, 1024))
    
    # Threshold + Blur
    mask_array = np.array(mask_img).astype(np.float32) / 255.0
    mask_array = (mask_array > 0.3).astype(np.float32)
    
    # Invert if needed (e.g. "change background" -> mask person -> invert)
    if invert:
        mask_array = 1.0 - mask_array
    
    # Gaussian blur for smooth edges
    mask_pil = Image.fromarray((mask_array * 255).astype(np.uint8))
    mask_pil = mask_pil.filter(ImageFilter.GaussianBlur(radius=5))
    
    # Save debug mask
    if debug:
        mask_pil.save(mask_output)
        print(f"[Debug] Mask saved: {mask_output}")
    
    # SDXL Inpainting
    print("[SDXL] Inpainting...")
    
    model_path = os.path.join(MODEL_DIR, "sdxl-inpaint")
    if not os.path.exists(model_path):
        model_path = "/tmp/sdxl-inpaint-model"
    
    pipe = StableDiffusionXLInpaintPipeline.from_pretrained(
        model_path,
        torch_dtype=torch.float32,
    )
    
    result_img = pipe(
        prompt=prompt,
        image=img,
        mask_image=mask_pil.convert("RGB"),
        num_inference_steps=30,
        guidance_scale=12.0,
        strength=0.95,
    ).images[0]
    
    result_img.save(output)
    # Convert PNG to JPEG for Telegram
    try:
        jpg_out = output.replace(".png", ".jpg")
        Image.open(output).convert("RGB").save(jpg_out, "JPEG", quality=92)
        os.remove(output)
        output = jpg_out
    except: pass
    print(f"[Done] Saved: {output}")
    
    result = {"output": output}
    if debug:
        result["mask"] = mask_output
    return result


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: ai-image.py generate|segment-edit ..."}))
        sys.exit(1)
    
    mode = sys.argv[1]
    
    if mode == "generate":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "Usage: ai-image.py generate 'PROMPT' [model] [steps]"}))
            sys.exit(1)
        
        prompt = sys.argv[2]
        model = sys.argv[3] if len(sys.argv) > 3 else "schnell"
        steps = int(sys.argv[4]) if len(sys.argv) > 4 else 4
        quantize = int(sys.argv[5]) if len(sys.argv) > 5 else 8

        result = generate_image(prompt, model, steps, quantize=quantize)
        print(json.dumps(result))
    
    elif mode == "segment-edit":
        if len(sys.argv) < 5:
            print(json.dumps({"error": "Usage: ai-image.py segment-edit INPUT TARGET PROMPT [--invert] [--debug]"}))
            sys.exit(1)
        
        input_image = sys.argv[2]
        target = sys.argv[3]
        prompt = sys.argv[4]
        invert = "--invert" in sys.argv
        debug = "--debug" in sys.argv
        
        result = segment_edit(input_image, target, prompt, invert, debug)
        print(json.dumps(result))
    
    else:
        print(json.dumps({"error": f"Unknown mode: {mode}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
