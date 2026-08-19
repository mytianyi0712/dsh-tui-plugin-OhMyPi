#!/usr/bin/env python3
import pathlib, json, zstandard, struct, hashlib, time, shutil, os

BASE = pathlib.Path(r'C:/Users/mytianyi/.dsh/sessions')

def decompress_zstd_multiframe(path: pathlib.Path) -> str:
    dctx = zstandard.ZstdDecompressor()
    with open(path, 'rb') as f:
        reader = dctx.stream_reader(f)
        chunks = []
        while True:
            c = reader.read(1<<20)
            if not c:
                break
            chunks.append(c)
        return b''.join(chunks).decode('utf-8')

def compress_zstd_singleframe(text: str) -> bytes:
    cctx = zstandard.ZstdCompressor(level=3)
    return cctx.compress(text.encode('utf-8'))

def repair_session(sess_path: pathlib.Path, dry_run=False):
    # decompress
    try:
        text = decompress_zstd_multiframe(sess_path)
    except Exception as e:
        print(f"  decompress failed {sess_path}: {e}")
        return False
    lines = text.splitlines()
    if not lines:
        return False
    header_line = lines[0]
    try:
        header = json.loads(header_line)
        if header.get('type') != 'session':
            print(f"  header not session: {sess_path}")
            return False
    except:
        print(f"  header parse fail {sess_path}")
        return False

    # First pass: collect valid ids/names per (turn,step)
    step_valid = {}  # (turn,step) -> {'id': str, 'name': str}
    # Also collect chunk valid per (turn,step)
    for idx, line in enumerate(lines[1:], start=1):
        try:
            obj = json.loads(line)
        except:
            continue
        t = obj.get('type')
        data = obj.get('data', {})
        # packed rows
        if t in ('tool-call-chunks',):
            turn = data.get('turn')
            step = data.get('step')
            if turn is None or step is None:
                continue
            key = (turn, step)
            cid = data.get('id')
            name = data.get('name')
            if cid and cid != '':
                if key not in step_valid:
                    step_valid[key] = {}
                if 'id' not in step_valid[key]:
                    step_valid[key]['id'] = cid
            if name and name != '':
                if key not in step_valid:
                    step_valid[key] = {}
                if 'name' not in step_valid[key]:
                    step_valid[key]['name'] = name
            continue
        # regular events with turn/step
        turn = data.get('turn')
        step = data.get('step')
        if turn is None or step is None:
            # assistant/message, tool/call etc have turn/step
            # but some events like chunk have it, others like request/header not
            continue
        key = (turn, step)
        # check various id locations
        cid = None
        name = None
        if t == 'assistant/chunk':
            chunk = data.get('chunk', {})
            if chunk.get('type') == 'tool-call-delta':
                cid = chunk.get('id')
                name = chunk.get('name')
            elif chunk.get('type') == 'block-end' and chunk.get('block', {}).get('type') == 'tool-call':
                block = chunk.get('block', {})
                cid = block.get('id')
                name = block.get('name')
        elif t == 'assistant/message':
            msg = data.get('message', {})
            for block in msg.get('content', []):
                if block.get('type') == 'tool-call':
                    if block.get('id') and block.get('id') != '':
                        cid = block.get('id')
                        name = block.get('name')
                        break
                    # if empty, not valid
        elif t == 'tool/call':
            cid = data.get('callId')
            name = data.get('name')
        elif t == 'tool/result':
            # not a call definition, but result's callId could be valid
            msg = data.get('message', {})
            source = msg.get('source', {})
            cid = source.get('callId')
            # name not applicable
        else:
            continue
        if cid and cid != '':
            if key not in step_valid:
                step_valid[key] = {}
            if 'id' not in step_valid[key]:
                step_valid[key]['id'] = cid
        if name and name != '':
            if key not in step_valid:
                step_valid[key] = {}
            if 'name' not in step_valid[key]:
                step_valid[key]['name'] = name

    # Decide repaired ids for steps that have empties but no valid
    # Also need to detect which steps actually have empties
    steps_with_empty = set()
    for line in lines[1:]:
        try:
            obj = json.loads(line)
        except:
            continue
        t = obj.get('type')
        data = obj.get('data', {})
        turn = data.get('turn')
        step = data.get('step')
        if turn is None or step is None:
            continue
        key = (turn, step)
        is_empty = False
        if t == 'tool-call-chunks' and data.get('id') == '':
            is_empty = True
        elif t == 'assistant/chunk':
            chunk = data.get('chunk', {})
            if chunk.get('type') == 'tool-call-delta' and chunk.get('id') == '':
                is_empty = True
            elif chunk.get('type') == 'block-end' and chunk.get('block', {}).get('type') == 'tool-call':
                block = chunk.get('block', {})
                if block.get('id') == '' or block.get('name') == '':
                    is_empty = True
        elif t == 'assistant/message':
            msg = data.get('message', {})
            for block in msg.get('content', []):
                if block.get('type') == 'tool-call' and (block.get('id') == '' or block.get('name') == ''):
                    is_empty = True
                    break
        elif t == 'tool/call' and (data.get('callId') == '' or data.get('name') == ''):
            is_empty = True
        elif t == 'tool/result':
            msg = data.get('message', {})
            source = msg.get('source', {})
            content = msg.get('content', [])
            if source.get('callId') == '':
                is_empty = True
            elif content and content[0].get('toolCallId') == '':
                is_empty = True
        if is_empty:
            steps_with_empty.add(key)

    # Prepare mapping for empty steps: assign repaired id
    repaired_map = {}
    for key in steps_with_empty:
        valid = step_valid.get(key, {})
        rid = valid.get('id')
        if not rid or rid == '':
            # generate deterministic
            turn, step = key
            rid = f"call_repaired_{turn}_{step}"
            # ensure uniqueness if multiple calls per step? use hash of header id?
            # For now, use turn_step
        rname = valid.get('name')
        if not rname or rname == '':
            # infer from cwd or default
            # check header cwd
            cwd = header.get('cwd', '')
            if ':\\' in cwd or 'D:' in cwd:
                # Windows - but request/header says bash, so use bash for consistency
                # However earlier we saw pwsh for dsh, but bash is more universal
                # Use bash as default
                rname = 'bash'
            else:
                rname = 'bash'
            # For dsh large session, the first valid was pwsh, but we already have valid for that step
            # So this fallback only for steps with no valid name (AI sessions)
        repaired_map[key] = {'id': rid, 'name': rname}

    # Second pass: patch lines
    patched_lines = [header_line]
    patched_count = 0
    for line in lines[1:]:
        try:
            obj = json.loads(line)
        except:
            patched_lines.append(line)
            continue
        t = obj.get('type')
        data = obj.get('data', {})
        turn = data.get('turn')
        step = data.get('step')
        key = (turn, step) if turn is not None and step is not None else None
        modified = False

        if t == 'tool-call-chunks':
            if data.get('id') == '' and key in repaired_map:
                obj['data']['id'] = repaired_map[key]['id']
                modified = True
            if (data.get('name') == '' or 'name' not in data) and key in repaired_map:
                # if name missing or empty, set to repaired name
                # but packed rows may or may not have name field
                if 'name' not in data or data['name'] == '':
                    # need to ensure we add name if missing and repaired has one
                    obj['data']['name'] = repaired_map[key]['name']
                    modified = True
        elif t == 'assistant/chunk':
            chunk = data.get('chunk', {})
            if chunk.get('type') == 'tool-call-delta':
                if chunk.get('id') == '' and key in repaired_map:
                    chunk['id'] = repaired_map[key]['id']
                    modified = True
                # name handling: if name is None or '' or missing, set to repaired name
                # The chunk may have no 'name' key at all (missing)
                if key in repaired_map:
                    # if name missing or empty, we should set it only if we have a valid name to preserve?
                    # But for delta, the assembler expects name to be present only on first delta
                    # For empty deltas that were missing name, we can leave as is, but if they have '' we fix
                    # Check if 'name' key exists and is '' or None -> fix
                    if 'name' in chunk and (chunk['name'] is None or chunk['name'] == ''):
                        # Remove None? Original had missing name as no key, not None. But our earlier dump showed "name": null for some
                        # For repair, set to repaired name
                        # But we should only set if we have a valid name and the delta is the first one? Actually subsequent deltas should not have name, they should keep previous
                        # So we should NOT add name to deltas that originally had no name; leave them as is
                        # Only fix if they had empty string '' or null
                        if chunk['name'] == '' or chunk['name'] is None:
                            # If we fix, we set to repaired name, but that would make continues check pass (since name would match)
                            # However the original bug was that subsequent deltas had empty id and missing name, causing not packed
                            # For repair, we want to make them consistent, so set name to repaired if needed?
                            # Let's set to repaired name only if the delta's id was empty and we are fixing id
                            # For now, leave name as is unless it's empty string '' (not missing)
                            if chunk.get('name') == '':
                                chunk['name'] = repaired_map[key]['name']
                                modified = True
                            elif chunk.get('name') is None:
                                # Remove null name? Better to delete key
                                del chunk['name']
                                modified = True
                    # If name missing entirely, leave it missing (don't add)
            elif chunk.get('type') == 'block-end' and chunk.get('block', {}).get('type') == 'tool-call':
                block = chunk.get('block')
                if block.get('id') == '' and key in repaired_map:
                    block['id'] = repaired_map[key]['id']
                    modified = True
                if (block.get('name') == '' or block.get('name') is None) and key in repaired_map:
                    block['name'] = repaired_map[key]['name']
                    modified = True
                # also fix arguments if empty but we have valid? Not needed
        elif t == 'assistant/message':
            msg = data.get('message', {})
            for block in msg.get('content', []):
                if block.get('type') == 'tool-call':
                    if block.get('id') == '' and key in repaired_map:
                        block['id'] = repaired_map[key]['id']
                        modified = True
                    if (block.get('name') == '' or block.get('name') is None) and key in repaired_map:
                        block['name'] = repaired_map[key]['name']
                        modified = True
        elif t == 'tool/call':
            if data.get('callId') == '' and key in repaired_map:
                data['callId'] = repaired_map[key]['id']
                modified = True
            if (data.get('name') == '' or data.get('name') is None) and key in repaired_map:
                data['name'] = repaired_map[key]['name']
                modified = True
        elif t == 'tool/result':
            msg = data.get('message', {})
            source = msg.get('source', {})
            if source.get('callId') == '' and key in repaired_map:
                source['callId'] = repaired_map[key]['id']
                modified = True
            # content toolCallId
            content = msg.get('content', [])
            if content and len(content) > 0:
                block = content[0]
                if block.get('toolCallId') == '' and key in repaired_map:
                    block['toolCallId'] = repaired_map[key]['id']
                    modified = True
                # also fix isError? Keep as is

        if modified:
            patched_count += 1
            # re-serialize with minimal separators
            patched_lines.append(json.dumps(obj, ensure_ascii=False, separators=(',', ':')))
        else:
            patched_lines.append(line)

    if patched_count == 0:
        print(f"  no patches needed for {sess_path}")
        return False

    print(f"  patched {patched_count} lines for {sess_path} (steps {list(repaired_map.keys())})")
    if dry_run:
        return True

    # backup
    backup = sess_path.with_suffix('.zstd.bak')
    # add timestamp to avoid overwrite
    if backup.exists():
        backup = sess_path.parent / f"session.jsonl.zstd.bak.{int(time.time())}"
    try:
        shutil.copy2(sess_path, backup)
        print(f"  backup -> {backup}")
    except Exception as e:
        print(f"  backup failed: {e}")
        return False

    # recompress
    new_text = '\n'.join(patched_lines) + '\n'
    new_bytes = compress_zstd_singleframe(new_text)
    # write atomically via temp file
    tmp = sess_path.with_suffix('.zstd.tmp')
    with open(tmp, 'wb') as f:
        f.write(new_bytes)
    # On Windows, need to handle replace
    try:
        os.replace(tmp, sess_path)
    except:
        # fallback
        sess_path.unlink()
        tmp.rename(sess_path)
    print(f"  wrote repaired {sess_path} ({len(new_bytes)} bytes compressed, {len(new_text)} decompressed)")

    # verify decompress and parse
    try:
        verify_text = decompress_zstd_multiframe(sess_path)
        vlines = verify_text.splitlines()
        # quick validation: check no empty callId remains
        empty_remaining = 0
        for l in vlines:
            if '"callId":""' in l or '"toolCallId":""' in l:
                # check if still empty
                try:
                    o=json.loads(l)
                    if o.get('type')=='tool/call' and o['data']['callId']=='':
                        empty_remaining+=1
                    if o.get('type')=='tool/result' and o['data']['message']['source']['callId']=='':
                        empty_remaining+=1
                except:
                    pass
        if empty_remaining>0:
            print(f"  WARNING: {empty_remaining} empties remain after patch!")
            return False
        else:
            print(f"  verify ok: no empties remain")
    except Exception as e:
        print(f"  verify failed: {e}")
        return False

    return True

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--target', type=str, default=None, help='specific session id to repair')
    args = parser.parse_args()
    base = BASE
    sessions = []
    for proj in base.iterdir():
        if not proj.is_dir():
            continue
        for sess_dir in proj.iterdir():
            p = sess_dir / 'session.jsonl.zstd'
            if not p.exists():
                continue
            if args.target and args.target not in str(sess_dir):
                continue
            sessions.append(p)
    print(f"found {len(sessions)} sessions")
    repaired = 0
    for p in sessions:
        # quick check if needs repair
        try:
            text = decompress_zstd_multiframe(p)
        except Exception as e:
            print(f"skip {p}: decompress fail {e}")
            continue
        if '"callId":""' in text or '"toolCallId":""' in text:
            # more precise: check for tool/call or tool/result empty
            # we already have heuristic, but just call repair
            print(f"repairing {p}")
            ok = repair_session(p, dry_run=args.dry_run)
            if ok:
                repaired+=1
        else:
            # also check chunk empty?
            if '"id":""' in text and 'tool-call-delta' in text:
                print(f"repairing (chunk) {p}")
                ok = repair_session(p, dry_run=args.dry_run)
                if ok:
                    repaired+=1
    print(f"done, repaired {repaired} sessions")

if __name__ == '__main__':
    main()
