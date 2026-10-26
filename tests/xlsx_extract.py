"""Estrae dal foglio Excel gli input (house.json) e gli output attesi (expected.json)."""
import sys, json, datetime, openpyxl

def d(v):
    return v.strftime("%Y-%m-%d") if isinstance(v, (datetime.datetime, datetime.date)) else None

def enc_result(v):
    if v in (None, ""): return ""
    v = str(v)
    if v == "Done": return "done"
    if v == "Skipped": return "skipped"
    if v.startswith("Skipped (") and v.endswith(")"): return "skipped:" + v[9:-1]
    return "by:" + v

def main(path, out_prefix):
    wf = openpyxl.load_workbook(path)
    wv = openpyxl.load_workbook(path, data_only=True)
    lf, lv = wf["Log"], wv["Log"]
    rf, rv = wf["Roommates"], wv["Roommates"]
    roommates = []
    for r in range(6, 18):
        name = rv.cell(r, 2).value
        if name:
            roommates.append({"id": str(name), "name": str(name), "slot": int(rv.cell(r, 3).value),
                              "from": d(rv.cell(r, 4).value), "to": d(rv.cell(r, 5).value)})
    settings = {"grace": int(rv["F25"].value), "minRest": int(rv["F26"].value),
                "startPriority": int(rv["F27"].value), "window": int(rv["F28"].value)}
    today = d(rv["F29"].value)
    start = d(lv["B4"].value)
    weeks, expected = {}, []
    last = lf.max_row
    for r in range(4, last + 1):
        sunday = d(lv[f"B{r}"].value)
        away = [str(lv[f"{c}{r}"].value) for c in "CDE" if lv[f"{c}{r}"].value]
        everyone = "Everyone" in away
        away = [a for a in away if a != "Everyone"]
        res = {k: enc_result(lv[f"{c}{r}"].value) for k, c in zip(["floor", "bathroom", "kitchen"], "JKL")}
        swap = {}
        for k, c in zip(["floor", "bathroom", "kitchen"], "FGH"):
            if not (isinstance(lf[f"{c}{r}"].value, str) and lf[f"{c}{r}"].value.startswith("=")):
                if lf[f"{c}{r}"].value: swap[k] = str(lf[f"{c}{r}"].value)
        w = {}
        if away: w["away"] = away
        if everyone: w["everyone"] = True
        if any(res.values()): w["result"] = res
        if swap: w["swap"] = swap
        if w: weeks[sunday] = w
        g = lambda c: lv[f"{c}{r}"].value
        expected.append({"sunday": sunday, "F": g("F") or "", "G": g("G") or "", "H": g("H") or "",
                         "I": g("I") or "", "M": g("M") or "",
                         "EW": g("EW") or "", "EX": g("EX") or "", "EY": g("EY") or ""})
    json.dump({"startSunday": start, "roommates": roommates, "settings": settings, "weeks": weeks, "today": today},
              open(out_prefix + ".house.json", "w"), indent=1)
    json.dump(expected, open(out_prefix + ".expected.json", "w"))
    print("ok", path, len(expected), "rows; today", today)

main(sys.argv[1], sys.argv[2])
