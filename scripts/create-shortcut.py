#!/usr/bin/env python3
"""
create-shortcut.py - macOS Shortcut Generator (for Croppy)

Usage:
  python3 create-shortcut.py --name "Name" --template urgent-reminder
  python3 create-shortcut.py --name "Name" --actions-json '[{...}]'
  python3 create-shortcut.py --export "Existing Shortcut Name"
  python3 create-shortcut.py --list

Templates: urgent-reminder, simple-reminder, speak, notification

Note: Import requires DJ to click "Add Shortcut" in the dialog.
"""

import plistlib, sqlite3, uuid, json, sys, os, subprocess, argparse

DB_PATH = os.path.expanduser("~/Library/Shortcuts/Shortcuts.sqlite")
TMP_DIR = "/tmp"

DEFAULT_INPUT_CLASSES = [
    "WFAppContentItem","WFAppStoreAppContentItem","WFArticleContentItem",
    "WFContactContentItem","WFDateContentItem","WFEmailAddressContentItem",
    "WFFolderContentItem","WFGenericFileContentItem","WFImageContentItem",
    "WFiTunesProductContentItem","WFLocationContentItem","WFDCMapsLinkContentItem",
    "WFAVAssetContentItem","WFPDFContentItem","WFPhoneNumberContentItem",
    "WFRichTextContentItem","WFSafariWebPageContentItem","WFStringContentItem",
    "WFURLContentItem"
]

def gen_uuid():
    return str(uuid.uuid4()).upper()

def make_text_token(output_uuid, output_name):
    return {"Value":{"string":"\ufffc","attachmentsByRange":{"{0, 1}":{"OutputUUID":output_uuid,"Type":"ActionOutput","OutputName":output_name}}},"WFSerializationType":"WFTextTokenString"}

def make_extension_input():
    return {"Value":{"Type":"ExtensionInput"},"WFSerializationType":"WFTextTokenAttachment"}

# === TEMPLATES ===

def template_urgent_reminder():
    s,f,l,a = gen_uuid(),gen_uuid(),gen_uuid(),gen_uuid()
    ref = lambda u: {"Value":{"OutputUUID":u,"Type":"ActionOutput","OutputName":"テキストを分割"},"WFSerializationType":"WFTextTokenAttachment"}
    return [
        {"WFWorkflowActionIdentifier":"is.workflow.actions.text.split","WFWorkflowActionParameters":{"text":make_extension_input(),"UUID":s}},
        {"WFWorkflowActionIdentifier":"is.workflow.actions.getitemfromlist","WFWorkflowActionParameters":{"WFInput":ref(s),"UUID":f}},
        {"WFWorkflowActionIdentifier":"is.workflow.actions.getitemfromlist","WFWorkflowActionParameters":{"WFInput":ref(s),"WFItemSpecifier":"Last Item","UUID":l}},
        {"WFWorkflowActionIdentifier":"is.workflow.actions.addnewreminder","WFWorkflowActionParameters":{"WFCalendarItemTitle":make_text_token(l,"リストからの項目"),"WFAlertCustomTime":make_text_token(f,"リストからの項目"),"WFAlertEnabled":"Alert","WFUrgent":True,"WFPriority":"High","UUID":a}},
        {"WFWorkflowActionIdentifier":"is.workflow.actions.output","WFWorkflowActionParameters":{"WFOutput":make_text_token(a,"新規リマインダー"),"UUID":gen_uuid()}}
    ]

def template_simple_reminder():
    a = gen_uuid()
    return [
        {"WFWorkflowActionIdentifier":"is.workflow.actions.addnewreminder","WFWorkflowActionParameters":{"WFCalendarItemTitle":make_extension_input(),"UUID":a}},
        {"WFWorkflowActionIdentifier":"is.workflow.actions.output","WFWorkflowActionParameters":{"WFOutput":make_text_token(a,"新規リマインダー"),"UUID":gen_uuid()}}
    ]

def template_speak():
    return [{"WFWorkflowActionIdentifier":"is.workflow.actions.speaktext","WFWorkflowActionParameters":{"WFTextToSpeak":make_extension_input()}}]

def template_notification():
    return [{"WFWorkflowActionIdentifier":"is.workflow.actions.notification","WFWorkflowActionParameters":{"WFNotificationActionBody":make_extension_input(),"WFNotificationActionTitle":"JARVIS"}}]

TEMPLATES = {"urgent-reminder":template_urgent_reminder,"simple-reminder":template_simple_reminder,"speak":template_speak,"notification":template_notification}

# === CORE ===

def generate_and_sign(name, actions, icon_color=4282601983, icon_glyph=59650):
    has_input = any("ExtensionInput" in json.dumps(a.get("WFWorkflowActionParameters",{})) for a in actions)
    shortcut = {
        "WFWorkflowClientVersion":"4528.0.4.2","WFWorkflowTypes":["NCWidget","WatchKit"],
        "WFWorkflowIcon":{"WFWorkflowIconStartColor":icon_color,"WFWorkflowIconGlyphNumber":icon_glyph},
        "WFWorkflowMinimumClientVersion":900,"WFWorkflowMinimumClientVersionString":"900",
        "WFWorkflowName":name,"WFWorkflowHasShortcutInputVariables":has_input,
        "WFWorkflowImportQuestions":[],"WFWorkflowInputContentItemClasses":DEFAULT_INPUT_CLASSES if has_input else [],
        "WFWorkflowActions":actions,
    }
    unsigned = os.path.join(TMP_DIR, f"{name}-unsigned.shortcut")
    signed = os.path.join(TMP_DIR, f"{name}.shortcut")
    with open(unsigned,"wb") as f:
        plistlib.dump(shortcut, f, fmt=plistlib.FMT_BINARY)
    r = subprocess.run(["shortcuts","sign","-i",unsigned,"-o",signed], capture_output=True, text=True)
    if r.returncode != 0:
        return None, f"Sign failed: {r.stderr}"
    os.remove(unsigned)
    return signed, None

def import_shortcut(path):
    subprocess.Popen(["open",path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return "DJが「ショートカットを追加」をクリックしてください。"

def export_actions(name):
    db = sqlite3.connect(DB_PATH)
    cur = db.execute("SELECT sa.ZDATA FROM ZSHORTCUTACTIONS sa JOIN ZSHORTCUT s ON sa.ZSHORTCUT=s.Z_PK WHERE s.ZNAME=?",(name,))
    row = cur.fetchone(); db.close()
    if not row or not row[0]: return f"ERROR: '{name}' not found"
    return json.dumps(plistlib.loads(row[0]), indent=2, default=str, ensure_ascii=False)

def list_shortcuts():
    db = sqlite3.connect(DB_PATH)
    cur = db.execute("SELECT Z_PK,ZNAME,ZACTIONCOUNT FROM ZSHORTCUT WHERE ZTOMBSTONED=0 ORDER BY ZNAME")
    lines = [f"{r[0]:3d} | {r[2]:2d} actions | {r[1]}" for r in cur.fetchall()]; db.close()
    return "\n".join(lines)

# === MAIN ===

def main():
    p = argparse.ArgumentParser(description="macOS Shortcut Generator")
    p.add_argument("--name")
    p.add_argument("--template", help=f"Templates: {', '.join(TEMPLATES.keys())}")
    p.add_argument("--actions-json", help="Actions as JSON string")
    p.add_argument("--list", action="store_true")
    p.add_argument("--export")
    p.add_argument("--no-import", action="store_true")
    args = p.parse_args()

    if args.list: print(list_shortcuts()); return
    if args.export: print(export_actions(args.export)); return
    if not args.name: p.print_help(); return

    actions = None
    if args.template:
        if args.template not in TEMPLATES: print(f"ERROR: Unknown template. Available: {', '.join(TEMPLATES.keys())}"); return
        actions = TEMPLATES[args.template]()
    elif args.actions_json:
        actions = json.loads(args.actions_json)
    else:
        print("ERROR: --template or --actions-json required"); return

    signed, err = generate_and_sign(args.name, actions)
    if err: print(f"ERROR: {err}"); return
    print(f"OK: {signed} ({len(actions)} actions)")
    if not args.no_import: print(import_shortcut(signed))

if __name__ == "__main__":
    main()
