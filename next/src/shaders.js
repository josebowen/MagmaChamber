export const NOISE = /* glsl */`
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn2(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1.,0.)),u.x), mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),u.x),u.y); }
float fbm2(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vn2(p); p=p*2.02+vec2(1.7,9.2); a*=0.5;} return s; }
float h31(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vn3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x), mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x), mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm3(vec3 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vn3(p); p=p*2.03+vec3(3.1,1.7,5.3); a*=0.5;} return s; }
// rising droplets: returns 0..1 brightness
float drops(vec2 p, float t, float speed, float dens, float r){
  vec2 g = vec2(p.x*0.9, p.y*0.9 - t*speed);
  vec2 id = floor(g); vec2 f = fract(g)-0.5;
  float h = h21(id);
  if (h > dens) return 0.0;
  vec2 o = vec2(h21(id+3.1)-0.5, h21(id+7.7)-0.5)*0.5;
  float d = length(f-o);
  return smoothstep(r, r*0.3, d);
}
`;

export const sectionVert = /* glsl */`
attribute float aTop; attribute float aBase;
varying vec2 vP; varying float vTop; varying float vBase;
void main(){ vP=position.xy; vTop=aTop; vBase=aBase; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;

export const sectionFrag = /* glsl */`
uniform float uTime, uSetting, uConduit, uChY, uFeed;
uniform vec4 uW; // young, shield, composite, cinder
uniform vec3 uMagma;
uniform float uPulse;
varying vec2 vP; varying float vTop; varying float vBase;
${NOISE}
vec3 L(vec3 c){ return pow(c, vec3(2.2)); }
void main(){
  float x=vP.x, y=vP.y;
  float d=vTop-y;
  float n=fbm2(vec2(x*0.09, y*0.22));
  float n2=fbm2(vec2(x*0.5, y*0.5));
  bool plume = uSetting < 0.5;
  float moho = plume ? -7.5 : -24.0;
  float lab  = plume ? -27.0 : -33.0;
  vec3 col;
  vec3 emis = vec3(0.0);

  // ---- plate geometry for subduction
  float trench = 50.0;
  float slabTop = x >= trench ? vBase : vBase + (x - trench)*0.78;
  bool inSlab = false; bool belowSlab = false;
  if (!plume){
    float th = x >= trench ? 13.0 : 9.0;
    if (y < slabTop && y > slabTop - th) inSlab = true;
    if (y <= slabTop - th) belowSlab = true;
  }

  if (y > vBase + 0.02) {
    // volcanic edifice, layered
    float band = fract(d*0.45 + n*1.2);
    float sb = smoothstep(.80, .92, band);
    vec3 shield = mix(vec3(.17,.15,.14), vec3(.27,.17,.13), sb);
    vec3 comp   = mix(vec3(.25,.21,.19), vec3(.40,.35,.30), smoothstep(.45, .6, band)*0.8);
    vec3 cinder = vec3(.30,.14,.10)*(0.65+0.7*h21(floor(vP*7.0)));
    vec3 young  = mix(vec3(.26,.22,.20), vec3(.34,.29,.25), smoothstep(.5,.7, band)*0.7);
    col = young*uW.x + shield*uW.y + comp*uW.z + cinder*uW.w;
    col *= 0.85 + 0.3*n2;
  } else if (!plume && inSlab) {
    float t = slabTop - y;
    col = t < 2.2 ? mix(vec3(.18,.19,.22), vec3(.30,.30,.30), n2) : mix(vec3(.22,.28,.36), vec3(.16,.21,.29), n);
    if (t < 0.35) col = vec3(.42,.40,.34); // sediment veneer
  } else if (!plume && belowSlab) {
    col = mix(vec3(.40,.21,.12), vec3(.50,.27,.13), fbm2(vec2(x*0.06, y*0.06 + uTime*0.01)));
  } else {
    float top = vBase;
    bool ocean = plume || x > trench;
    float mo = ocean ? (plume ? moho : vBase - 2.5) : moho;
    float la = ocean ? (plume ? lab : vBase - 13.0) : lab;
    if (y > top - 0.6 && ocean) {
      col = vec3(.44,.40,.31); // seafloor sediment
    } else if (y > mo) {
      if (ocean) { col = mix(vec3(.16,.16,.17), vec3(.26,.25,.25), step(.55, fract(y*1.3 + n*2.0))); }
      else {
        float s = smoothstep(.35, .65, fract(y*0.22 + n*1.4));
        col = y > -13.0 ? mix(vec3(.47,.40,.35), vec3(.42,.36,.33), s) : mix(vec3(.33,.32,.35), vec3(.29,.29,.32), s);
        col *= 0.88 + 0.24*n2;
        col = mix(col, col*0.82, smoothstep(0.6, 0.0, abs(y + 13.0)) * 0.6);
      }
    } else if (y > la) {
      col = mix(vec3(.29,.27,.18), vec3(.24,.23,.16), n2);
    } else {
      // asthenosphere, slowly convecting
      float c = fbm2(vec2(x*0.05 + uTime*0.01, y*0.07 - uTime*0.015));
      col = mix(vec3(.40,.20,.11), vec3(.56,.28,.13), c) * (1.0 + (la - y)*0.008);
    }
    // Moho and LAB lines
    if (!ocean || plume) {
      col *= 1.0 - 0.35*smoothstep(0.35, 0.0, abs(y - mo));
    }
  }

  // ---- plume (hot rock, not magma)
  if (plume) {
    float w = 3.4 + 0.8*sin(y*0.25 + uTime*0.5);
    float head = smoothstep(-34.0, -29.0, y) * (1.0 - smoothstep(-27.5, -26.5, y));
    float hw = mix(w, 15.0, head);
    float pm = (1.0 - smoothstep(hw*0.75, hw, abs(x))) * (1.0 - smoothstep(-27.5, -26.8, y));
    vec3 hot = mix(vec3(.80,.36,.12), vec3(.95,.55,.20), fbm2(vec2(x*0.2, y*0.15 - uTime*0.25)));
    col = mix(col, hot, pm*0.92);
    // partial melt at the top of the plume head
    float mz = (1.0 - smoothstep(10.0, 13.0, abs(x))) * smoothstep(-31.0, -29.0, y) * (1.0 - smoothstep(-27.2, -26.8, y));
    emis += uMagma * 0.9 * drops(vP, uTime, 1.3, 0.5, 0.33) * mz * uFeed;
  } else {
    // water released from the slab rising into the mantle wedge
    float wz = smoothstep(trench-48.0, trench-44.0, x) * (1.0 - smoothstep(trench-36.0, trench-32.0, x));
    float above = smoothstep(slabTop, slabTop + 0.6, y) * (1.0 - smoothstep(slabTop + 7.0, slabTop + 10.0, y));
    emis += vec3(0.25, 0.75, 1.6) * drops(vP*1.4, uTime, 1.6, 0.4, 0.28) * wz * above;
    // flux melting zone
    float mzx = 1.0 - smoothstep(6.0, 12.0, abs(x - 3.0));
    float mzy = smoothstep(-43.0, -40.0, y) * (1.0 - smoothstep(-31.0, -28.0, y));
    float mz = mzx * mzy * (y > slabTop ? 1.0 : 0.0);
    col = mix(col, vec3(.62,.30,.13), mz*0.55);
    emis += uMagma * 0.9 * drops(vP, uTime, 1.1, 0.45, 0.33) * mz * uFeed;
  }

  // ---- feeder dike from the melt zone to the chamber
  float meltTop = plume ? -27.0 : -29.0;
  float dx = abs(x - 0.45*sin(y*0.45));
  float dike = (1.0 - smoothstep(0.22, 0.42, dx)) * step(meltTop, y) * step(y, uChY - 1.6);
  float travel = 0.6 + 0.4*sin(y*1.2 + uTime*3.0);
  emis += uMagma * dike * travel * 0.9 * uFeed;
  col = mix(col, vec3(.25,.08,.04), dike*0.7);

  // ---- magma chamber
  vec2 cp = (vP - vec2(0.0, uChY)) / vec2(5.8, 2.3);
  float e = length(cp);
  float cham = 1.0 - smoothstep(0.93, 1.0, e);
  float mush = smoothstep(0.80, 0.95, e) * cham;
  float flow = fbm2(vP*0.55 + vec2(uTime*0.25, -uTime*0.1));
  float bub = drops(vP*2.2, uTime, 0.6, 0.35, 0.22);
  vec3 mag = uMagma * (0.65 + 0.55*flow) * (1.0 + 0.25*uPulse);
  mag = mix(mag, uMagma*0.12, bub*0.85);
  mag = mix(mag, uMagma*0.35, mush);
  col = mix(col, vec3(0.0), cham);
  emis += mag * cham * 0.8;
  float halo = exp(-max(e - 1.0, 0.0)*5.0) * (1.0 - cham);
  emis += uMagma * 0.10 * halo;
  col = mix(col, vec3(.45,.20,.10), halo*0.6);

  // ---- conduit from chamber to crater
  float cx = abs(x - 0.22*sin(y*0.6));
  float conduit = (1.0 - smoothstep(0.38, 0.55, cx)) * step(uChY + 1.8, y);
  float lit = step(y, mix(uChY + 1.8, vTop + 0.5, uConduit));
  col = mix(col, vec3(.10,.08,.08), conduit);
  emis += uMagma * 1.0 * conduit * lit * (0.75 + 0.35*sin(y*2.0 - uTime*9.0));

  gl_FragColor = vec4(L(col) + emis, 1.0);
}
`;

export const skyVert = /* glsl */`
varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }
`;
export const skyFrag = /* glsl */`
uniform float uAsh; varying vec3 vD;
vec3 L(vec3 c){ return pow(c, vec3(2.2)); }
void main(){
  float h = vD.y;
  vec3 horizon = vec3(.98,.58,.36);
  vec3 mid = vec3(.42,.38,.55);
  vec3 top = vec3(.05,.07,.17);
  vec3 c = h < 0.0 ? mix(horizon*0.5, vec3(.17,.10,.09), smoothstep(0.0, -0.3, h))
                   : mix(mix(horizon, mid, smoothstep(0.0, 0.18, h)), top, smoothstep(0.15, 0.7, h));
  float sun = pow(max(dot(vD, normalize(vec3(-0.75, 0.05, -0.66))), 0.0), 600.0);
  c += vec3(1.0,.75,.45)*sun*0.5;
  c = mix(c, vec3(.28,.24,.22)*(0.7+0.3*h), uAsh*0.7);
  gl_FragColor = vec4(L(c), 1.0);
}
`;

export const pointVert = /* glsl */`
attribute vec3 color; attribute float size; attribute float alpha;
uniform float uScale; varying vec3 vC; varying float vA;
void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;
  gl_PointSize = size*uScale/max(0.5,-mv.z); vC = color; vA = alpha; }
`;
export const glowFrag = /* glsl */`
varying vec3 vC; varying float vA;
void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5, 0.0, d); a*=a; gl_FragColor = vec4(vC, a*vA); }
`;
export const ashFrag = /* glsl */`
varying vec3 vC; varying float vA;
void main(){ vec2 p = gl_PointCoord-0.5; float d = length(p);
  float a = smoothstep(0.5, 0.12, d);
  float shade = 0.72 + 0.55*(0.5 - p.y) - 0.15*d;
  gl_FragColor = vec4(vC*shade, a*vA); }
`;

export const wallVert = /* glsl */`
varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;
export const wallFrag = /* glsl */`
uniform float uTime, uFlow; uniform vec3 uHot; varying vec3 vD;
${NOISE}
void main(){
  float t = uTime*uFlow;
  vec3 p = vD*2.4;
  float n = fbm3(p + vec3(0.0, -t*0.35, t*0.12));
  float n2 = fbm3(p*2.3 + vec3(n*1.8, -t*0.6, 0.0));
  float hot = smoothstep(0.38, 0.78, n2);
  vec3 crust = vec3(.10,.018,.006);
  vec3 c = mix(crust, uHot*0.75, hot) * (0.55 + 0.7*n);
  c += uHot*0.18*pow(n2, 3.0);
  gl_FragColor = vec4(c, 1.0);
}
`;

export const bubbleVert = /* glsl */`
varying vec3 vN; varying vec3 vV;
void main(){
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position,1.0);
  vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix*mv;
}
`;
export const bubbleFrag = /* glsl */`
uniform vec3 uRim; uniform float uP; uniform float uTime;
varying vec3 vN; varying vec3 vV;
void main(){
  float f = 1.0 - max(dot(vN, vV), 0.0);
  float rim = pow(f, 2.4);
  vec3 c = mix(vec3(0.02,0.006,0.003), uRim*(1.0 + uP*0.8*(0.5+0.5*sin(uTime*7.0))), rim);
  float spec = pow(max(dot(reflect(-vV, vN), normalize(vec3(0.3,0.8,0.5))), 0.0), 40.0);
  c += vec3(1.6,1.2,0.8)*spec;
  gl_FragColor = vec4(c, 0.55 + 0.45*rim);
}
`;

export const domeFrag = /* glsl */`
uniform float uTime; uniform vec3 uMagma; varying vec3 vP;
${NOISE}
void main(){
  float n = fbm3(vP*2.2 + vec3(0.0, uTime*0.05, 0.0));
  float crack = smoothstep(0.035, 0.0, abs(n - 0.5));
  vec3 rock = pow(vec3(.20,.17,.16)*(0.7+0.6*fbm3(vP*6.0)), vec3(2.2));
  gl_FragColor = vec4(rock + uMagma*crack*1.6, 1.0);
}
`;
export const domeVert = /* glsl */`
varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;
