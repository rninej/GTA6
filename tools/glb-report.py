import json, struct, sys, os, math

def read_glb(p):
    d = open(p,'rb').read()
    magic, ver, ln = struct.unpack_from('<III', d, 0)
    assert magic == 0x46546C67, p
    off = 12
    js = None
    while off < ln:
        clen, ctype = struct.unpack_from('<II', d, off)
        chunk = d[off+8:off+8+clen]
        if ctype == 0x4E4F534A: js = json.loads(chunk)
        off += 8 + clen + ((4 - clen % 4) % 4 if clen % 4 else 0)
    return js

def mat_mul(a,b):
    return [sum(a[i*4+k]*b[k*4+j] for k in range(4)) for i in range(4) for j in range(4)]

def node_mat(n):
    if 'matrix' in n: return n['matrix']
    t = n.get('translation',[0,0,0]); q = n.get('rotation',[0,0,0,1]); s = n.get('scale',[1,1,1])
    x,y,z,w = q
    xx,yy,zz = x*x,y*y,z*z; xy,xz,yz = x*y,x*z,y*z; wx,wy,wz = w*x,w*y,w*z
    R = [1-2*(yy+zz), 2*(xy-wz), 2*(xz+wy),
         2*(xy+wz), 1-2*(xx+zz), 2*(yz-wx),
         2*(xz-wy), 2*(yz+wx), 1-2*(xx+yy)]
    return [R[0]*s[0], R[1]*s[1], R[2]*s[2], t[0],
            R[3]*s[0], R[4]*s[1], R[5]*s[2], t[1],
            R[6]*s[0], R[7]*s[1], R[8]*s[2], t[2],
            0,0,0,1]

def xform(m,p):
    return [m[0]*p[0]+m[1]*p[1]+m[2]*p[2]+m[3],
            m[4]*p[0]+m[5]*p[1]+m[6]*p[2]+m[7],
            m[8]*p[0]+m[9]*p[1]+m[10]*p[2]+m[11]]

ID = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]

def report(p):
    g = read_glb(p)
    tris = 0
    boxes = []
    def walk(idx, m, depth=0, path=''):
        nonlocal tris
        n = g['nodes'][idx]
        m2 = mat_mul(m, node_mat(n))
        nm = n.get('name','')
        meshes = []
        if 'mesh' in n:
            for pr in g['meshes'][n['mesh']].get('primitives',[]):
                acc = g['accessors'][pr['attributes']['POSITION']]
                if 'indices' in pr:
                    tris += g['accessors'][pr['indices']]['count']//3
                else:
                    tris += acc['count']//3
                if 'min' in acc:
                    lo, hi = acc['min'], acc['max']
                    for cx in (lo[0],hi[0]):
                        for cy in (lo[1],hi[1]):
                            for cz in (lo[2],hi[2]):
                                boxes.append(xform(m2,[cx,cy,cz]))
            meshes = [g['meshes'][n['mesh']].get('name','')]
        if (depth<=2) and (nm or meshes):
            print('  '*depth + f"{nm or '-'}  mesh={meshes}")
        for c in n.get('children',[]):
            walk(c, m2, depth+1)
    for s in g.get('scenes',[{}])[0].get('nodes',[]):
        walk(s, ID)
    if boxes:
        xs=[b[0] for b in boxes]; ys=[b[1] for b in boxes]; zs=[b[2] for b in boxes]
        print(f"  bbox X {min(xs):.2f}..{max(xs):.2f} (w {max(xs)-min(xs):.2f})  Y {min(ys):.2f}..{max(ys):.2f} (h {max(ys)-min(ys):.2f})  Z {min(zs):.2f}..{max(zs):.2f} (l {max(zs)-min(zs):.2f})")
    mats = [m.get('name','?') for m in g.get('materials',[])]
    print(f"  tris {tris}  meshes {len(g.get('meshes',[]))}  materials {len(mats)} {mats[:8]}  images {len(g.get('images',[]))}  textures {len(g.get('textures',[]))}")
    # textures with sizes
    for i,im in enumerate(g.get('images',[])[:6]):
        print('   img', i, im.get('mimeType'), im.get('name',''), 'uri' in im)

for p in sys.argv[1:]:
    print('==', os.path.basename(p))
    try: report(p)
    except Exception as e: print('  ERR', e)
