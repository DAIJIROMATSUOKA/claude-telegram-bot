#!/usr/bin/env python3
"""
Machinelab CORE (Contextual Operational Retrieval Engine)
顧客名でも案件番号でも、会社の全記憶を30秒で経営レベルの要約に変える中枢
"""

import subprocess, os, csv, io, sys, json, glob, re
from pathlib import Path
from datetime import datetime

# === Config ===
DB_PATH = "/Users/daijiromatsuokam1/Machinelab Dropbox/Matsuoka Daijiro/MLDatabase.accdb"
PROJECT_DIR = "/Users/daijiromatsuokam1/Machinelab Dropbox/machinelab/プロジェクト"
ETC_DIR = "/Users/daijiromatsuokam1/Machinelab Dropbox/machinelab/etc"

os.environ["MDB_ICONV"] = "UTF-8"

# === DB Access ===
def load_table(table_name):
    r = subprocess.run(["mdb-export", DB_PATH, table_name], capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        return []
    return list(csv.DictReader(io.StringIO(r.stdout)))

def load_all():
    data = {}
    tables = ["販売先", "販売先詳細", "販売先担当", "見積書", "見積書詳細",
              "プロジェクトデータ", "納品先", "納品先詳細", "進捗状況", "受注一覧表",
              "注文書", "注文書詳細", "仕入先", "ML", "ML詳細", "ML担当"]
    for t in tables:
        data[t] = load_table(t)
    return data

# === Dropbox Search ===
def find_project_folders(query):
    """Search project folders matching query"""
    results = []
    try:
        for year_dir in sorted(Path(PROJECT_DIR).iterdir()):
            if not year_dir.is_dir():
                continue
            for proj_dir in sorted(year_dir.iterdir()):
                if not proj_dir.is_dir():
                    continue
                name = proj_dir.name
                if query.lower() in name.lower():
                    # Count files
                    file_count = sum(1 for _ in proj_dir.rglob("*") if _.is_file())
                    results.append({"path": str(proj_dir), "name": name, "files": file_count})
    except Exception as e:
        pass
    return results

def find_files_in_folder(folder_path, max_files=50):
    """List files in a project folder with types"""
    files = {"cad": [], "doc": [], "image": [], "pdf": [], "excel": [], "other": []}
    ext_map = {
        "cad": [".zsdx", ".dxf", ".dwg", ".step", ".stp", ".iges", ".3dm", ".sldprt", ".sldasm"],
        "doc": [".docx", ".doc", ".txt", ".rtf"],
        "image": [".jpg", ".jpeg", ".png", ".bmp", ".heic", ".tif", ".tiff"],
        "pdf": [".pdf"],
        "excel": [".xlsx", ".xls", ".csv", ".numbers"],
    }
    try:
        count = 0
        for f in sorted(Path(folder_path).rglob("*")):
            if not f.is_file() or count >= max_files:
                break
            ext = f.suffix.lower()
            categorized = False
            for cat, exts in ext_map.items():
                if ext in exts:
                    files[cat].append(f.name)
                    categorized = True
                    break
            if not categorized:
                files["other"].append(f.name)
            count += 1
    except:
        pass
    return files

def search_dropbox_by_keyword(keyword, max_results=20):
    """Search etc/ and project folders for keyword in folder/file names"""
    results = []
    search_dirs = [PROJECT_DIR, ETC_DIR]
    for base in search_dirs:
        try:
            r = subprocess.run(
                ["find", base, "-maxdepth", "4", "-iname", f"*{keyword}*", "-type", "f"],
                capture_output=True, text=True, timeout=10
            )
            for line in r.stdout.strip().split("\n"):
                if line.strip():
                    results.append(line.strip())
                    if len(results) >= max_results:
                        break
        except:
            pass
        if len(results) >= max_results:
            break
    return results

# === Customer Mode ===
def customer_profile(data, query):
    """Generate customer profile by name search"""
    # Find matching client
    clients = data["販売先"]
    matched = None
    for c in clients:
        if query.lower() in c["販売先"].lower() or query.lower() in c.get("ふりがな", "").lower():
            matched = c
            break

    if not matched:
        # Fuzzy: also search in project names and delivery sites
        print(f"販売先テーブルに「{query}」が見つかりません。")
        print("プロジェクト名・納品先から検索中...")
        return customer_search_by_project(data, query)

    client_id = matched["販売先ID"]
    client_name = matched["販売先"]
    print(f"{'='*60}")
    print(f"顧客プロファイル: {client_name}")
    print(f"{'='*60}")

    # Get all projects for this client
    projects = [p for p in data["プロジェクトデータ"] if p["販売先ID"] == client_id]
    print(f"\nプロジェクト数: {len(projects)}件")

    # Get all quotes for these projects
    proj_nos = set(p["プロジェクトNo"] for p in projects)
    quotes = [q for q in data["見積書"] if q["プロジェクトNo"] in proj_nos]

    won = [q for q in quotes if q["受注"] == "1"]
    lost = [q for q in quotes if q["却下"] == "1"]
    pending = [q for q in quotes if q["受注"] == "0" and q["却下"] == "0"]

    print(f"\n--- 見積実績 ---")
    print(f"見積総数: {len(quotes)}件")
    print(f"受注: {len(won)}件")
    print(f"却下: {len(lost)}件")
    print(f"保留/進行中: {len(pending)}件")
    if len(quotes) > 0:
        win_rate = len(won) / len(quotes) * 100
        print(f"受注率: {win_rate:.1f}%")

    # Calculate revenue from quote details
    quote_nos_won = set(q["見積書No"] for q in won)
    details = [d for d in data["見積書詳細"] if d["見積書No"] in quote_nos_won]
    total_revenue = 0
    for d in details:
        try:
            qty = float(d["数量"] or 0)
            price = float(d["単価"].replace(",", "") if d["単価"] else 0)
            total_revenue += qty * price
        except:
            pass
    if total_revenue > 0:
        print(f"受注総額(見積ベース): ¥{total_revenue:,.0f}")

    # Device types
    device_types = {}
    for q in quotes:
        dev = q.get("装置名", "").strip()
        if dev:
            device_types[dev] = device_types.get(dev, 0) + 1
    if device_types:
        print(f"\n--- 装置種類 ---")
        for dev, count in sorted(device_types.items(), key=lambda x: -x[1])[:10]:
            print(f"  {dev}: {count}件")

    # Recent projects
    recent = sorted(projects, key=lambda p: p.get("開始日", ""), reverse=True)[:10]
    if recent:
        print(f"\n--- 最近のプロジェクト ---")
        for p in recent:
            proj_no = p["プロジェクトNo"]
            q_for_proj = [q for q in quotes if q["プロジェクトNo"] == proj_no]
            status = "受注" if any(q["受注"] == "1" for q in q_for_proj) else "却下" if any(q["却下"] == "1" for q in q_for_proj) else "保留"
            print(f"  No.{proj_no}: {p['プロジェクト名'][:40]} ({p.get('開始日', 'N/A')[:10]}) [{status}]")

    # Pending large quotes
    if pending:
        print(f"\n--- 未受注案件 ---")
        pending_with_amounts = []
        for q in pending:
            q_details = [d for d in data["見積書詳細"] if d["見積書No"] == q["見積書No"]]
            amount = 0
            for d in q_details:
                try:
                    amount += float(d["数量"] or 0) * float(d["単価"].replace(",", "") if d["単価"] else 0)
                except:
                    pass
            pending_with_amounts.append((q, amount))
        pending_with_amounts.sort(key=lambda x: -x[1])
        for q, amt in pending_with_amounts[:10]:
            print(f"  見積No.{q['見積書No']}: {q.get('名称', '')[:30]} ¥{amt:,.0f} ({q.get('見積書作成日', '')[:10]})")

    # Delivery sites
    delivery_ids = set(p["納品先ID"] for p in projects if p.get("納品先ID"))
    deliveries = [n for n in data["納品先"] if n["納品先ID"] in delivery_ids]
    if deliveries:
        print(f"\n--- 納品先 ---")
        for d in deliveries[:10]:
            print(f"  {d['納品先']}")

    # Dropbox folders
    folders = find_project_folders(query)
    if not folders:
        # Search by project numbers
        for p in projects[:20]:
            pno = p["プロジェクトNo"]
            if pno:
                f = find_project_folders(str(pno))
                folders.extend(f)
    if folders:
        total_files = sum(f["files"] for f in folders)
        print(f"\n--- Dropbox ({len(folders)}フォルダ, {total_files}ファイル) ---")
        for f in folders[:10]:
            print(f"  {f['name']} ({f['files']}ファイル)")

    #担当者
    contacts = [c for c in data.get("販売先担当", []) if any(
        d["販売先ID"] == client_id and d["販売先詳細ID"] == c.get("販売先詳細ID", "")
        for d in data.get("販売先詳細", [])
    )]
    if not contacts:
        # Direct match
        details_for_client = [d for d in data.get("販売先詳細", []) if d["販売先ID"] == client_id]
        detail_ids = set(d["販売先詳細ID"] for d in details_for_client)
        contacts = [c for c in data.get("販売先担当", []) if c.get("販売先詳細ID", "") in detail_ids]
    if contacts:
        print(f"\n--- 担当者 ---")
        for c in contacts:
            dept = c.get("部署", "")
            role = c.get("役職", "")
            print(f"  {c['販売先担当']} {dept} {role}")

def customer_search_by_project(data, query):
    """Fallback: search by project name or delivery site"""
    # Search in project names
    matching_projects = [p for p in data["プロジェクトデータ"]
                        if query.lower() in p.get("プロジェクト名", "").lower()]

    # Search in delivery sites
    matching_sites = [n for n in data["納品先"]
                     if query.lower() in n.get("納品先", "").lower()
                     or query.lower() in n.get("ふりがな", "").lower()]

    if matching_projects:
        print(f"\nプロジェクト名に「{query}」を含む案件: {len(matching_projects)}件")
        for p in matching_projects[:15]:
            print(f"  No.{p['プロジェクトNo']}: {p['プロジェクト名']} ({p.get('開始日', '')[:10]})")

        # Find related client
        client_ids = set(p["販売先ID"] for p in matching_projects if p.get("販売先ID"))
        if client_ids:
            clients = [c for c in data["販売先"] if c["販売先ID"] in client_ids]
            print(f"\n関連販売先:")
            for c in clients:
                print(f"  {c['販売先']} (ID={c['販売先ID']})")

    if matching_sites:
        print(f"\n納品先に「{query}」を含む: {len(matching_sites)}件")
        for s in matching_sites[:10]:
            print(f"  {s['納品先']} (ID={s['納品先ID']})")

    # Dropbox search
    folders = find_project_folders(query)
    if folders:
        print(f"\nDropboxフォルダ: {len(folders)}件")
        for f in folders[:10]:
            print(f"  {f['name']} ({f['files']}ファイル)")

    files = search_dropbox_by_keyword(query)
    if files:
        print(f"\nDropboxファイル検索: {len(files)}件")
        for f in files[:10]:
            print(f"  {f}")

# === Project Mode ===
def project_profile(data, query):
    """Generate project profile by project number or name"""
    # Try as number first
    proj_no = None
    try:
        # Extract number from query like "M1012" or "1012" or "25051"
        nums = re.findall(r'\d+', query)
        if nums:
            proj_no = nums[0]
    except:
        pass

    project = None
    if proj_no:
        project = next((p for p in data["プロジェクトデータ"] if str(p["プロジェクトNo"]) == proj_no), None)

    if not project:
        # Search by name
        matches = [p for p in data["プロジェクトデータ"]
                  if query.lower() in p.get("プロジェクト名", "").lower()]
        if matches:
            project = matches[0]
            if len(matches) > 1:
                print(f"複数マッチ ({len(matches)}件):")
                for m in matches[:5]:
                    print(f"  No.{m['プロジェクトNo']}: {m['プロジェクト名']}")
                print(f"\n最初の案件を表示:\n")

    if not project:
        print(f"プロジェクト「{query}」が見つかりません。")
        # Dropbox search fallback
        folders = find_project_folders(query)
        if folders:
            print(f"\nDropboxフォルダ検索結果:")
            for f in folders[:10]:
                print(f"  {f['name']} ({f['files']}ファイル): {f['path']}")
        return

    p_no = project["プロジェクトNo"]
    print(f"{'='*60}")
    print(f"プロジェクト No.{p_no}: {project['プロジェクト名']}")
    print(f"{'='*60}")
    print(f"開始日: {project.get('開始日', 'N/A')[:10]}")

    # Client info
    client_id = project.get("販売先ID", "")
    client = next((c for c in data["販売先"] if c["販売先ID"] == client_id), None)
    if client:
        print(f"販売先: {client['販売先']}")

    # Delivery site
    delivery_id = project.get("納品先ID", "")
    delivery = next((n for n in data["納品先"] if n["納品先ID"] == delivery_id), None)
    if delivery:
        print(f"納品先: {delivery['納品先']}")
    elif project.get("納品先手入力"):
        print(f"納品先: {project['納品先手入力']}")

    # ML (internal) info
    ml_id = project.get("MLID", "")
    ml = next((m for m in data.get("ML", []) if m.get("MLID") == ml_id), None)

    # Quotes
    quotes = [q for q in data["見積書"] if q["プロジェクトNo"] == p_no]
    print(f"\n--- 見積書 ({len(quotes)}件) ---")
    for q in quotes:
        status = "✅受注" if q["受注"] == "1" else "❌却下" if q["却下"] == "1" else "⏳保留"
        q_details = [d for d in data["見積書詳細"] if d["見積書No"] == q["見積書No"]]
        amount = 0
        for d in q_details:
            try:
                amount += float(d["数量"] or 0) * float(d["単価"].replace(",", "") if d["単価"] else 0)
            except:
                pass
        print(f"  見積No.{q['見積書No']}: {q.get('名称', '')[:40]} [{status}]")
        print(f"    金額: ¥{amount:,.0f} | 作成日: {q.get('見積書作成日', '')[:10]}")
        if q.get("装置名"):
            print(f"    装置: {q['装置名']} (Machine: {q.get('マシンNo', '')})")
        if q.get("受注日"):
            print(f"    受注日: {q['受注日'][:10]} | 納品日: {q.get('納品日', '')[:10]}")

        # Line items
        if q_details:
            print(f"    明細 ({len(q_details)}品目):")
            for d in q_details[:8]:
                name = d.get("商品名", "")[:35]
                qty = d.get("数量", "")
                price = d.get("単価", "")
                try:
                    line_total = float(qty or 0) * float(str(price).replace(",", "") if price else 0)
                    print(f"      - {name} x{qty} @¥{float(str(price).replace(',','')):.0f} = ¥{line_total:,.0f}")
                except:
                    print(f"      - {name} x{qty}")
            if len(q_details) > 8:
                print(f"      ... 他{len(q_details)-8}品目")

    # Order info
    orders = [o for o in data.get("受注一覧表", []) if o.get("プロジェクトNo") == p_no]
    if orders:
        print(f"\n--- 受注情報 ---")
        for o in orders:
            prog_id = o.get("進捗状況", "")
            prog = next((s for s in data["進捗状況"] if s["ID"] == prog_id), None)
            prog_name = prog["進捗状況"] if prog else "不明"
            print(f"  進捗: {prog_name}")
            print(f"  受注予定: {o.get('受注予定', '')} | 納品予定: {o.get('納品予定', '')}")

    # Dropbox files
    folders = find_project_folders(str(p_no))
    if not folders:
        # Try with M prefix
        folders = find_project_folders(f"M{p_no}")
    if folders:
        print(f"\n--- Dropboxフォルダ ---")
        for f in folders:
            print(f"  {f['path']}")
            print(f"  ファイル数: {f['files']}")
            file_types = find_files_in_folder(f["path"])
            for cat, files in file_types.items():
                if files:
                    print(f"    {cat}: {len(files)}件 ({', '.join(files[:3])}{'...' if len(files)>3 else ''})")

    # Similar projects (same client or same device type)
    if client_id:
        similar = [p for p in data["プロジェクトデータ"]
                  if p["販売先ID"] == client_id and p["プロジェクトNo"] != p_no]
        if similar:
            print(f"\n--- 同じ顧客の他プロジェクト ({len(similar)}件) ---")
            for s in sorted(similar, key=lambda x: x.get("開始日", ""), reverse=True)[:5]:
                print(f"  No.{s['プロジェクトNo']}: {s['プロジェクト名'][:40]} ({s.get('開始日', '')[:10]})")

# === Summary Mode ===
def company_summary(data):
    """Overall company stats"""
    quotes = data["見積書"]
    won = [q for q in quotes if q["受注"] == "1"]
    lost = [q for q in quotes if q["却下"] == "1"]

    print(f"{'='*60}")
    print(f"Machinelab CORE - 全社サマリー")
    print(f"{'='*60}")
    print(f"顧客数: {len(data['販売先'])}社")
    print(f"プロジェクト数: {len(data['プロジェクトデータ'])}件")
    print(f"見積総数: {len(quotes)}件 (受注{len(won)} / 却下{len(lost)} / 保留{len(quotes)-len(won)-len(lost)})")
    print(f"受注率: {len(won)/len(quotes)*100:.1f}%" if quotes else "")
    print(f"納品先: {len(data['納品先'])}社")

    # Revenue by client
    print(f"\n--- 顧客別受注額 TOP10 ---")
    client_revenue = {}
    for q in won:
        p = next((p for p in data["プロジェクトデータ"] if p["プロジェクトNo"] == q["プロジェクトNo"]), None)
        if not p:
            continue
        c_id = p["販売先ID"]
        c_name = next((c["販売先"] for c in data["販売先"] if c["販売先ID"] == c_id), "不明")
        details = [d for d in data["見積書詳細"] if d["見積書No"] == q["見積書No"]]
        amount = 0
        for d in details:
            try:
                amount += float(d["数量"] or 0) * float(d["単価"].replace(",", "") if d["単価"] else 0)
            except:
                pass
        client_revenue[c_name] = client_revenue.get(c_name, 0) + amount

    for name, rev in sorted(client_revenue.items(), key=lambda x: -x[1])[:10]:
        print(f"  {name}: ¥{rev:,.0f}")

# === Main ===
def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 machinelab-core.py customer <name>  - 顧客プロファイル")
        print("  python3 machinelab-core.py project <number> - 案件プロファイル")
        print("  python3 machinelab-core.py search <keyword> - Dropbox検索")
        print("  python3 machinelab-core.py summary          - 全社サマリー")
        sys.exit(1)

    mode = sys.argv[1]
    query = " ".join(sys.argv[2:]) if len(sys.argv) > 2 else ""

    print("データ読み込み中...")
    data = load_all()
    print(f"読み込み完了: 販売先{len(data['販売先'])}社, 見積{len(data['見積書'])}件, プロジェクト{len(data['プロジェクトデータ'])}件\n")

    if mode == "customer":
        customer_profile(data, query)
    elif mode == "project":
        project_profile(data, query)
    elif mode == "search":
        files = search_dropbox_by_keyword(query)
        folders = find_project_folders(query)
        if folders:
            print(f"フォルダ: {len(folders)}件")
            for f in folders[:15]:
                print(f"  {f['name']} ({f['files']}ファイル)")
        if files:
            print(f"\nファイル: {len(files)}件")
            for f in files[:15]:
                print(f"  {f}")
        if not folders and not files:
            print(f"「{query}」に該当するファイル/フォルダが見つかりません。")
    elif mode == "summary":
        company_summary(data)
    else:
        print(f"不明なモード: {mode}")

if __name__ == "__main__":
    main()
