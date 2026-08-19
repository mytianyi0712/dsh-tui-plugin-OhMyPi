import json, sys

path = sys.argv[1]
assistant_tool_msgs = 0
with_reasoning = 0
without_reasoning = 0
examples = []
with open(path, encoding='utf-8') as f:
    for line in f:
        try:
            ev = json.loads(line)
        except Exception:
            continue
        if ev.get('type') != 'assistant/message':
            continue
        content = ev.get('data', {}).get('message', {}).get('content', [])
        has_tool = any(b.get('type') == 'tool-call' for b in content)
        if not has_tool:
            continue
        assistant_tool_msgs += 1
        has_reasoning = any(b.get('type') == 'reasoning' and b.get('text','').strip() for b in content)
        if has_reasoning:
            with_reasoning += 1
        else:
            without_reasoning += 1
            if len(examples) < 3:
                examples.append(ev)
print(f"assistant tool-call messages: {assistant_tool_msgs}")
print(f"with reasoning: {with_reasoning}")
print(f"without reasoning: {without_reasoning}")
for ev in examples:
    print(json.dumps(ev, ensure_ascii=False)[:800])
