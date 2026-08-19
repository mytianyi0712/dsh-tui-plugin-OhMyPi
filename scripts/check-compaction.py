import json, sys

path = sys.argv[1]
count = 0
with open(path, encoding='utf-8') as f:
    for line in f:
        try:
            ev = json.loads(line)
        except Exception:
            continue
        t = ev.get('type')
        if isinstance(t, str) and 'compaction' in t:
            count += 1
            data = ev.get('data', {})
            err = data.get('error')
            text = json.dumps(ev, ensure_ascii=False)
            print(f"--- {count} {t} err={err!r}")
            print(text[:1200])
