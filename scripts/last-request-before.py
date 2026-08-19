import json, sys

path = sys.argv[1]
target = int(sys.argv[2])
with open(path, encoding='utf-8') as f:
    for line in f:
        try:
            ev = json.loads(line)
        except Exception:
            continue
        if ev.get('seq', 0) >= target:
            break
        t = ev.get('type')
        if t in ('assistant/message', 'user/message') and ev.get('data', {}).get('message', {}).get('source'):
            print(json.dumps(ev, ensure_ascii=False)[:800])
            print('---')
