import json, sys

path = sys.argv[1]
count = 0
with open(path, encoding='utf-8') as f:
    for line in f:
        try:
            ev = json.loads(line)
        except Exception:
            continue
        if ev.get('type') == 'compaction/end':
            count += 1
            print(f"{count} seq={ev.get('seq')} err={ev.get('data',{}).get('error')!r}")
