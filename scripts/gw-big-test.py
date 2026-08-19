import json, urllib.request, sys

url = 'http://localhost:3000/v1/chat/completions'
mb = int(sys.argv[1]) if len(sys.argv) > 1 else 5
big = 'x' * (mb * 1024 * 1024)
messages = [{'role': 'system', 'content': 'sys'}, {'role': 'user', 'content': big}]
body = json.dumps({'model': 'deepseek-v4-pro-0813', 'messages': messages, 'stream': False, 'max_completion_tokens': 64})
print('body bytes', len(body))
req = urllib.request.Request(url, data=body.encode(), headers={'Content-Type': 'application/json', 'Authorization': 'Bearer 123'})
try:
    with urllib.request.urlopen(req, timeout=180) as resp:
        print('HTTP', resp.status)
        print(resp.read(200).decode('utf-8', 'replace'))
except urllib.error.HTTPError as e:
    print('HTTP', e.code)
    print(e.read(500).decode('utf-8', 'replace'))
