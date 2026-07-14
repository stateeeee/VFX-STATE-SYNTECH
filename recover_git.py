import os
import zlib
import sys

def scan_objects(repo_dir):
    obj_dir = os.path.join(repo_dir, '.git', 'objects')
    for root, dirs, files in os.walk(obj_dir):
        if 'pack' in root or 'info' in root:
            continue
        for f in files:
            path = os.path.join(root, f)
            try:
                with open(path, 'rb') as fp:
                    data = fp.read()
                decomp = zlib.decompress(data)
                type_size, content = decomp.split(b'\0', 1)
                if type_size.startswith(b'blob'):
                    if b'EFFECTS_REGISTRY' in content:
                        print(f"FOUND IN: {path}")
                        with open(f"recovered_{f}.ts", 'wb') as out:
                            out.write(content)
            except Exception as e:
                pass

scan_objects('.')
