#!/usr/bin/env python3
"""Patch ai-media.py: outpaint params (cfg/denoise/lora) - outpaint workflow only"""

FILE = '/Users/daijiromatsuokam1/claude-telegram-bot/scripts/ai-media.py'

with open(FILE, 'r') as f:
    lines = f.readlines()

changes = 0
in_outpaint = False

for i, line in enumerate(lines):
    if 'def build_flux_outpaint_workflow' in line:
        in_outpaint = True
    elif in_outpaint and line.startswith('def '):
        in_outpaint = False

    if in_outpaint:
        if '"cfg": 3.5' in line:
            lines[i] = line.replace('"cfg": 3.5', '"cfg": 4.5')
            changes += 1
            print(f"L{i+1}: cfg 3.5 -> 4.5")
        if '"denoise": denoise' in line:
            lines[i] = line.replace('"denoise": denoise', '"denoise": 0.85  # outpaint fixed')
            changes += 1
            print(f"L{i+1}: denoise -> 0.85")
        if '"strength_model": lora_strength' in line:
            lines[i] = line.replace('"strength_model": lora_strength', '"strength_model": 0.3  # outpaint: reduce LoRA')
            changes += 1
            print(f"L{i+1}: lora_strength -> 0.3")

if changes == 3:
    with open(FILE, 'w') as f:
        f.writelines(lines)
    print(f"\n✅ {changes} changes applied")
else:
    print(f"\n❌ Expected 3 changes, found {changes}. NOT modified.")
    exit(1)
