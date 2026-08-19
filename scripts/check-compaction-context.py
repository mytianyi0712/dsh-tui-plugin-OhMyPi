import json, sys

path = sys.argv[1]
events = []
with open(path, encoding='utf-8') as f:
    for line in f:
        try:
            ev = json.loads(line)
        except Exception:
            continue
        t = ev.get('type')
        if t in ('command/run', 'command/done', 'compaction/start', 'compaction/end', 'compaction/summary'):
            events.append(ev)
for ev in events[-40:]:
    print(json.dumps(ev, ensure_ascii=False)[:1200])
    print('---')
