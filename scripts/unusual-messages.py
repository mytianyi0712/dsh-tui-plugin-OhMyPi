import json, sys
from collections import Counter

path = sys.argv[1]
issues = Counter()
examples = {}
with open(path, encoding='utf-8') as f:
    for line in f:
        try:
            ev = json.loads(line)
        except Exception:
            continue
        t = ev.get('type')
        if t not in ('user/message', 'assistant/message'):
            continue
        data = ev.get('data', {})
        msg = data.get('message', {})
        role = msg.get('role')
        content = msg.get('content', [])
        if not isinstance(content, list):
            issues['content-not-list'] += 1
            continue
        if role == 'assistant':
            has_tool = any(b.get('type') == 'tool-call' for b in content)
            has_reasoning = any(b.get('type') == 'reasoning' and b.get('text','').strip() for b in content)
            if has_tool and not has_reasoning:
                issues['assistant-tool-without-reasoning'] += 1
                examples.setdefault('assistant-tool-without-reasoning', []).append(ev.get('seq'))
            for b in content:
                if b.get('type') == 'tool-call':
                    if not isinstance(b.get('arguments'), str):
                        issues['tool-call-arguments-not-string'] += 1
                        examples.setdefault('tool-call-arguments-not-string', []).append(ev.get('seq'))
                    if b.get('id') is None or b.get('name') is None:
                        issues['tool-call-missing-id-or-name'] += 1
                        examples.setdefault('tool-call-missing-id-or-name', []).append(ev.get('seq'))
        if role == 'user':
            tool_results = [b for b in content if b.get('type') == 'tool-result']
            text_blocks = [b for b in content if b.get('type') == 'text']
            if tool_results:
                for tr in tool_results:
                    if not isinstance(tr.get('toolCallId'), str):
                        issues['tool-result-missing-toolCallId'] += 1
                    inner = tr.get('content', [])
                    if not isinstance(inner, list):
                        issues['tool-result-content-not-list'] += 1
                    for ib in inner:
                        if ib.get('type') not in ('text',):
                            issues['tool-result-non-text'] += 1
                            examples.setdefault('tool-result-non-text', []).append(ev.get('seq'))
print('issues:')
for k, v in issues.items():
    print(k, v, examples.get(k, [])[:5])
