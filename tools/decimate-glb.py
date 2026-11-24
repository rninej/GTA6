import json,struct,sys,subprocess,os
import numpy as np

def load(path):
    d=open(path,'rb').read(); off=12; ch=[]
    while off<len(d):
        cl,ct=struct.unpack('<II',d[off:off+8]); off+=8; ch.append([ct,bytearray(d[off:off+cl])]); off+=cl
    return json.loads(ch[0][1]), ch[1][1]

def read_acc(j,bin,ai):
    a=j['accessors'][ai]; bv=j['bufferViews'][a['bufferView']]
    dt={5120:('i1',1),5121:('u1',1),5122:('i2',2),5123:('u2',2),5125:('u4',4),5126:('f4',4)}[a['componentType']]
    nc={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    start=bv.get('byteOffset',0)+a.get('byteOffset',0); n=a['count']
    stride=bv.get('byteStride') or dt[1]*nc
    if stride==dt[1]*nc:
        return np.frombuffer(bytes(bin),dtype=np.dtype(dt[0]),count=n*nc,offset=start).reshape(n,nc)
    return np.ascontiguousarray(np.ndarray(shape=(n,nc),dtype=np.dtype(dt[0]),buffer=bytes(bin),offset=start,strides=(stride,dt[1])))

def decimate(src,dst,ratio):
    j,bin=load(src)
    def cluster(pos,cell):
        keys=(pos//cell).astype(np.int64)
        uniq,inv=np.unique(keys,axis=0,return_inverse=True)
        order=np.argsort(inv,kind='stable'); inv_s=inv[order]
        starts=np.searchsorted(inv_s,np.arange(len(uniq)))
        first=order[starts]
        return first[inv]
    def add_idx(arr):
        nonlocal bin
        while len(bin)%4: bin.append(0)
        o=len(bin); bin+=arr.astype('<u4').tobytes()
        j['bufferViews'].append({'buffer':0,'byteOffset':o,'byteLength':arr.size*4,'target':34963})
        j['accessors'].append({'bufferView':len(j['bufferViews'])-1,'componentType':5125,'count':int(arr.size),'type':'SCALAR'})
        return len(j['accessors'])-1
    before=after=0
    for m in j['meshes']:
        for p in m['primitives']:
            pos=read_acc(j,bin,p['attributes']['POSITION']).astype(np.int64)
            if 'indices' in p: idx=read_acc(j,bin,p['indices']).astype(np.int64).reshape(-1,3)
            else: idx=np.arange(len(pos),dtype=np.int64).reshape(-1,3)
            before+=len(idx); tgt=max(8,int(len(idx)*ratio))
            lo,hi=1,30000; best=None
            for _ in range(16):
                cell=(lo+hi)//2; rep=cluster(pos,cell)
                tri=rep[idx]; keep=(tri[:,0]!=tri[:,1])&(tri[:,1]!=tri[:,2])&(tri[:,0]!=tri[:,2])
                n=int(keep.sum())
                if n>tgt: lo=cell+1
                else: hi=cell-1; best=(rep,keep)
                if lo>hi: break
            if best is None: continue
            rep,keep=best; tri=rep[idx][keep]
            p['indices']=add_idx(tri.reshape(-1)); after+=len(tri)
    j['buffers'][0]['byteLength']=len(bin)
    js=json.dumps(j,separators=(',',':')).encode()
    while len(js)%4: js+=b' '
    out=bytearray(struct.pack('<III',0x46546C67,2,12+8+len(js)+8+len(bin)))
    out+=struct.pack('<II',len(js),0x4E4F534A)+js
    out+=struct.pack('<II',len(bin),0x004E4942)+bin
    open(dst,'wb').write(out)
    return before,after

if __name__=='__main__':
    src,dst,ratio=sys.argv[1],sys.argv[2],float(sys.argv[3])
    b,a=decimate(src,dst,ratio)
    print(f"{os.path.basename(src)} {b} -> {a} tris")
