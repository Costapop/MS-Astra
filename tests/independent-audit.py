#!/usr/bin/env python3
"""Reproduce the independent optics audit using only Python's standard library.

Run from any directory: python3 tests/independent-audit.py --node /path/to/node
The audit reads the production optics through Node, independently checks Fresnel
recursion and book admittance/adjoint formulas in Python, then checks high-Q
cavities using 85-digit Decimal arithmetic. It writes no repository files.
"""
import json,cmath,math
from pathlib import Path
import argparse, subprocess
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--node',default='node',help='Node.js executable (default: node)')
args=parser.parse_args()
producer=Path(__file__).with_name('audit-cases.mjs')
payload=json.loads(subprocess.check_output([args.node,str(producer)],text=True))
cases=payload['cases']
worst={'R':(0,None),'energy':(0,None),'needle_abs':(0,None),'needle_scaled':(0,None),'gradient_abs':(0,None),'gradient_scaled':(0,None),'jacobian_abs':(0,None),'jacobian_adjoint_abs':(0,None),'jacobian_adjoint_scaled':(0,None)}
def track(name,error,where):
 if error>worst[name][0]:worst[name]=(error,where)
def reflectance(layers,lam,ns):
 if not layers:return ((1-ns)/(1+ns))**2
 r=(layers[-1]['n']-ns)/(layers[-1]['n']+ns)
 for j in reversed(range(len(layers))):
  n=layers[j]['n'];above=layers[j-1]['n'] if j else 1
  p=cmath.exp(-4j*math.pi*n*layers[j]['d']/lam)
  rho=(above-n)/(above+n)
  r=(rho+r*p)/(1+rho*r*p)
 return abs(r)**2
checks=0
for ci,case in enumerate(cases):
 ls=case['layers'];ns=case['ns'];L=len(case['wavelengths']);sc=[]
 for qi,lam in enumerate(case['wavelengths']):
  k=2*math.pi/lam;A=complex(ns);bottoms=[None]*len(ls);cs=[None]*len(ls)
  for j in reversed(range(len(ls))):
   n=ls[j]['n'];d=ls[j]['d'];bottoms[j]=A;s=math.sin(k*n*d);co=math.cos(k*n*d)
   c=co+1j*A*s/n;cs[j]=c;A=(1j*n*s+A*co)/c
  r=(1-A)/(1+A);R=abs(r)**2
  psi=(2/L)*(R-case['target'][qi])*r.conjugate()*(1+r)**2
  tops=[]
  psiR=r.conjugate()*(1+r)**2
  topsR=[]
  for j in range(len(ls)):
   tops.append(psi);psi=psi/(cs[j]**2)
   topsR.append(psiR);psiR=psiR/(cs[j]**2)
  sc.append((k,bottoms,cs,tops,topsR))
  track('R',abs(case['R'][qi]-reflectance(ls,lam,ns)),(ci,qi))
  track('energy',abs(case['R'][qi]+case['T'][qi]-1),(ci,qi))
 for ni,needle in enumerate(case['needles']):
  j=needle['j'];n=ls[j]['n'];xb=ls[j]['d']-needle['position'];g=0
  for k,As,cs,tops,topsR in sc:
   c=math.cos(k*n*xb)+1j*As[j]*math.sin(k*n*xb)/n
   psi=tops[j]*(c/cs[j])**2
   g+=k*psi.imag*(needle['needleN']**2-n**2)
  error=abs(g-needle['g']);track('needle_abs',error,(ci,ni));track('needle_scaled',error/max(1e-10,abs(g),abs(needle['g'])),(ci,ni,g,needle['g']));checks+=1
 for j,layer in enumerate(ls):
  n=layer['n'];xb=layer['d']*.371;g=0
  for k,As,cs,tops,topsR in sc:
   s=math.sin(k*n*xb);co=math.cos(k*n*xb);c=co+1j*As[j]*s/n
   A=(1j*n*s+As[j]*co)/c;psi=tops[j]*(c/cs[j])**2
   g+=k*(psi*(n*n-A*A)).imag
  jsg=2/L*sum((case['R'][q]-case['target'][q])*case['J'][q][j] for q in range(L))
  error=abs(g-jsg);track('gradient_abs',error,(ci,j));track('gradient_scaled',error/max(1e-10,abs(g),abs(jsg)),(ci,j,g,jsg))
  for q,(k,As,cs,tops,topsR) in enumerate(sc):
   s=math.sin(k*n*xb);co=math.cos(k*n*xb);c=co+1j*As[j]*s/n
   A=(1j*n*s+As[j]*co)/c;psiR=topsR[j]*(c/cs[j])**2
   jr=k*(psiR*(n*n-A*A)).imag
   error=abs(jr-case['J'][q][j])
   track('jacobian_adjoint_abs',error,(ci,j,q,jr,case['J'][q][j]))
   track('jacobian_adjoint_scaled',error/max(1e-10,abs(jr),abs(case['J'][q][j])),(ci,j,q))
  # Full independent Fresnel forward model, centrally differenced for spectral Jacobian.
  h=max(1e-4,layer['d']*1e-6)
  plus=[{**l,'d':l['d']+(h if i==j else 0)} for i,l in enumerate(ls)]
  minus=[{**l,'d':l['d']-(h if i==j else 0)} for i,l in enumerate(ls)]
  for q,lam in enumerate(case['wavelengths']):
   fd=(reflectance(plus,lam,ns)-reflectance(minus,lam,ns))/(2*h)
   track('jacobian_abs',abs(fd-case['J'][q][j]),(ci,j,q))

# Independently evaluate difficult cavities with standard-library Decimal.
# Decimal(float) preserves the exact binary input rather than its short display.
from decimal import Decimal as D, getcontext
getcontext().prec=85
PI=D('3.141592653589793238462643383279502884197169399375105820974944592307816406286208998628')
def sincos(x):
 x=x%(2*PI)
 if x>PI: x-=2*PI
 ss=st=x; cc=ct=D(1); xx=x*x
 for k in range(1,130):
  st*=-xx/D((2*k)*(2*k+1)); ct*=-xx/D((2*k-1)*(2*k))
  ss+=st; cc+=ct
  if abs(st)+abs(ct)<D('1e-82'): break
 return ss,cc

def mul(a,b):
 return [a[0]*b[0]-a[1]*b[2],a[0]*b[1]+a[1]*b[3],
         a[2]*b[0]+a[3]*b[2],a[3]*b[3]-a[2]*b[1]]

def mat(n,d,wl):
 s,c=sincos(2*PI*n*d/wl)
 return [c,s/n,n*s,c]

def response(M,K=None):
 ns=D(1.52); nr=M[0]-ns*M[3]; ni=ns*M[1]-M[2]
 dr=M[0]+ns*M[3]; di=ns*M[1]+M[2]; den=dr*dr+di*di
 R=(nr*nr+ni*ni)/den
 if K is None: return R
 dnr=K[0]-ns*K[3]; dni=ns*K[1]-K[2]
 ddr=K[0]+ns*K[3]; ddi=ns*K[1]+K[2]
 return 2*(nr*dnr+ni*dni-R*(dr*ddr+di*ddi))/den

high_precision=[]
for case in payload['highQ']:
 ls=case['layers']; wl=D(case['wavelength']); j=case['j']
 matrices=[mat(D(layer['n']),D(layer['d']),wl) for layer in ls]
 identity=[D(1),D(0),D(0),D(1)]; prefix=[identity]; suffix=[None]*(len(ls)+1); suffix[-1]=identity
 for M in matrices: prefix.append(mul(prefix[-1],M))
 for i in reversed(range(len(ls))): suffix[i]=mul(matrices[i],suffix[i+1])
 n=D(ls[j]['n']); k=2*PI/wl; G=[D(0),k,k*n*n,D(0)]
 J=response(prefix[-1],mul(mul(prefix[j],mul(G,matrices[j])),suffix[j+1]))
 # Position is itself a double parameter, just like the JavaScript API input.
 x=D(ls[j]['d']*.271)
 left=mul(prefix[j],mat(n,x,wl)); right=mul(mat(n,D(ls[j]['d'])-x,wl),suffix[j+1])
 difference=[D(0),D(0),k*(D(1.38)**2-n*n),D(0)]
 R=response(prefix[-1])
 needle=2*(R-D(.2))*response(prefix[-1],mul(mul(left,difference),right))
 record={'layers':len(ls),'R_85digit':str(R),'R_abs_error':float(abs(D(case['R'])-R)),
         'J_85digit':str(J),'J_relative_error':float(abs((D(case['J'])-J)/J)),
         'needle_85digit':str(needle),'needle_relative_error':float(abs((D(case['needle'])-needle)/needle))}
 high_precision.append(record)
 assert record['R_abs_error']<2e-13
 assert record['J_relative_error']<1e-10
 assert record['needle_relative_error']<1e-10

# Floors reflect the conditioning of near-zero derivatives, not a relative-error
# claim for quantities whose true value is numerically indistinguishable from 0.
assert worst['R'][0]<1e-11
assert worst['energy'][0]<1e-11
assert worst['jacobian_adjoint_abs'][0]<1e-10
assert worst['gradient_abs'][0]<1e-11
assert worst['needle_abs'][0]<1e-11
print(json.dumps({'random_seed':'0x694fa128','cases':len(cases),
 'spectral_points':sum(len(c['R']) for c in cases),
 'jacobian_entries':sum(len(c['R'])*len(c['layers']) for c in cases),
 'gradient_entries':sum(len(c['layers']) for c in cases),
 'needle_checks':checks,'worst_random_errors':worst,
 'high_precision_cavities':high_precision},indent=2))
