#!/bin/bash
# Ricalcola con LibreOffice gli scenari in $S/in e confronta con il motore JS.
S=/tmp/claude-0/-home-user/31bb54fa-07b7-55b0-a8eb-c0a272017a85/scratchpad/xl
cd $S/out && timeout 1500 soffice --headless --calc --convert-to xlsx --outdir $S/out $S/in/s*.xlsx >/dev/null 2>&1
cd /home/user/tidyhouse/tests
fail=0
for f in $S/out/s*.xlsx; do i=$(basename $f .xlsx)
  python3 -I xlsx_extract.py $f $S/$i >/dev/null && node compare.mjs $S/$i 2>&1 | tail -3 | grep -q "diffs 0$" || { echo "FAIL $i"; node compare.mjs $S/$i | head -5; fail=1; }
done
echo "FINITO fail=$fail scenari=$(ls $S/out/s*.xlsx | wc -l)"
