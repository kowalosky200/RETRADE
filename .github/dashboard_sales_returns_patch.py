from pathlib import Path
import subprocess

branch='fix/dashboard-sales-returns-series'
subprocess.run(['git','fetch','origin',branch+':refs/remotes/origin/'+branch],check=True)
src=subprocess.check_output(['git','show','origin/'+branch+':.github/workflows/dashboard-sales-returns-series.yml'],text=True)
marker="          python - <<'PY'\n"
end="\n          PY\n"
if marker not in src or end not in src:
    raise SystemExit('embedded dashboard patch script not found')
body=src.split(marker,1)[1].split(end,1)[0]
lines=[]
for line in body.splitlines():
    lines.append(line[10:] if line.startswith('          ') else line)
exec('\n'.join(lines),{'__name__':'__main__'})
