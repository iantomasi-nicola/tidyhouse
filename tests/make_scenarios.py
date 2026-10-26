import re, sys, random, datetime, openpyxl, copy
SRC = sys.argv[1]; OUT = sys.argv[2]; N = int(sys.argv[3])
START = datetime.datetime(2026, 10, 4)
def build(seed):
    rnd = random.Random(seed)
    wb = openpyxl.load_workbook(SRC)
    lg, rm = wb["Log"], wb["Roommates"]
    kind = seed % 6
    names = {0: ["Antonio","Duygu","Nicola"], 1: ["Antonio","Duygu","Nicola","Marta"], 2: ["Antonio","Duygu"],
             3: ["Antonio","Duygu","Nicola"], 4: ["Antonio","Duygu","Nicola","Marta"], 5: ["Antonio","Duygu","Nicola"]}[kind]
    for r in range(6, 18):
        for c in range(2, 6): rm.cell(r, c).value = None
    for i, n in enumerate(names):
        rm.cell(6 + i, 2).value = n; rm.cell(6 + i, 3).value = i + 1
    people = list(names)
    nweeks = 45
    today_week = 38
    rm["F29"].value = START + datetime.timedelta(days=7 * today_week - 3)   # un giovedi' in mezzo alla settimana
    rm["F25"].value = rnd.choice([0, 1, 2])
    rm["F26"].value = rnd.choice([2, 3, 4])
    rm["F27"].value = rnd.choice([0, 2, 4, 6])
    rm["F28"].value = rnd.choice([0, 10, 52])
    # movimenti inquilini
    if kind in (3, 4):
        # l'ultimo se ne va alla settimana 15 e arriva uno nuovo nello stesso slot alla 18
        leave = START + datetime.timedelta(days=7 * 15 - 2)
        rm.cell(5 + len(names), 5).value = leave
        newname = "Zeno"
        rm.cell(6 + len(names), 2).value = newname
        rm.cell(6 + len(names), 3).value = len(names)
        rm.cell(6 + len(names), 4).value = START + datetime.timedelta(days=7 * 18)
        people.append(newname)
    if kind == 5:
        rm.cell(7, 4).value = START + datetime.timedelta(days=7 * 6)   # Duygu arriva alla settimana 6
    for w in range(nweeks):
        r = 4 + w
        sunday = START + datetime.timedelta(days=7 * w)
        away = []
        for p in people:
            if rnd.random() < 0.13: away.append(p)
        if rnd.random() < 0.03 and w > 0: away = ["Everyone"]
        for c, a in zip((3, 4, 5), away[:3]): lg.cell(r, c).value = a
        if w < today_week:
            for c in (10, 11, 12):
                x = rnd.random()
                if x < 0.70: v = "Done"
                elif x < 0.76: v = None
                elif x < 0.84: v = "Skipped"
                elif x < 0.94: v = rnd.choice(people)
                else: v = "Skipped (%s)" % rnd.choice(people)
                lg.cell(r, c).value = v
        if kind in (2, 5) and rnd.random() < 0.05:
            lg.cell(r, 6 + rnd.randrange(3)).value = rnd.choice(people)   # swap manuale
    fix = lambda t: re.sub(r"(?<![\w.])MAXIFS\(", "_xlfn.MAXIFS(", t)
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                v = c.value
                if isinstance(v, str) and v.startswith("=") and "MAXIFS(" in v: c.value = fix(v)
                elif hasattr(v, "text") and v.text and "MAXIFS(" in v.text: v.text = fix(v.text)
    wb.save(f"{OUT}/s{seed}.xlsx")
for s in range(N): build(s)
print("generati", N)
