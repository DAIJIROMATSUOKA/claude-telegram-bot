import json
d = json.load(open("/tmp/todoist-resp.json"))
tasks = d.get("results", [])
if not tasks:
    print("\U0001f4cb \u4eca\u65e5\u306e\u30bf\u30b9\u30af\u306a\u3057")
else:
    print(f"\U0001f4cb \u4eca\u65e5\u306e\u30bf\u30b9\u30af ({len(tasks)}\u4ef6):")
    for t in tasks:
        p = "\U0001f534" if t.get("priority", 1) == 4 else "\U0001f7e1" if t.get("priority", 1) == 3 else "\u26aa"
        print(f"  {p} {t['content']} (id:{t['id']})")
