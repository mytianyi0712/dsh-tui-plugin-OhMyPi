import json, urllib.request, sys

url = 'http://localhost:3000/v1/chat/completions'
n = int(sys.argv[1]) if len(sys.argv) > 1 else 500
messages = [{'role': 'system', 'content': 'sys'}]
for i in range(n):
    messages.append({'role': 'user', 'content': f'msg {i}'})
    messages.append({'role': 'assistant', 'content': f'ok {i}'})
body = json.dumps({'model': 'deepseek-v4-pro-0813', 'messages': messages, 'stream': False, 'reasoning_effort': 'max', 'max_completion_tokens': 256})
req = urllib.request.Request(url, data=body.encode(), headers={'Content-Type': 'application/json', 'Authorization': 'Bearer 123'})
try:
    with urllib.request.urlopen(req, timeout=120) as resp:
        print('HTTP', resp.status)
        data = resp.read(200)
        print(data.decode('utf-8', 'replace')[:300])
except urllib.error.HTTPError as e:
    print('HTTP', e.code)
    print(e.read(500).decode('utf-8', 'replace'))
