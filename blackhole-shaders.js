// Shader equations adapted from the supplied BlackHoleHeroSection reference.
export const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const SCENE_FRAG = `
precision highp float;

#define MAX_STEPS 460

#define WIND_CYCLE 46.0

varying vec2 vUv;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uCamPos;
uniform vec3  uRight;
uniform vec3  uUp;
uniform vec3  uFwd;
uniform float uTanHalf;
uniform vec2  uFocus;
uniform float uSteps;
uniform float uSkyR;
uniform float uDiskIn;
uniform float uDiskOut;
uniform float uThick;
uniform float uDensity;
uniform float uSpin;
uniform float uGrain;
uniform float uBright;
uniform float uDoppler;
uniform vec3  uHot;
uniform vec3  uMid;
uniform vec3  uCool;
uniform float uStars;
uniform float uEncode;
uniform vec2  uJitter;
uniform float uSeed;

float hash13(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

float fbm(vec3 p, float lod) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += (i == 3 ? a * lod : a) * vnoise(p);
    p = p * 2.03 + vec3(11.3, 7.1, 3.7);
    a *= 0.5;
  }
  return s;
}

void gasAt(vec3 p, float rd, float dt, out float dens, out vec3 tint, out float heat) {
  float rn = clamp((rd - uDiskIn) / max(0.001, uDiskOut - uDiskIn), 0.0, 1.0);

  float tk = uThick * (0.35 + 1.25 * rn);
  float v = p.y / tk;
  float sheet = exp(-v * v);

  float lod = clamp(1.0 - dt * uGrain * 14.0, 0.0, 1.0);

  float phi = atan(p.z, p.x);

  float omega = uSpin * pow(uDiskIn / rd, 1.5);

  float lr = log(rd) * 1.1 + uSpin * uTime * 0.05;

  float u = uTime / WIND_CYCLE;
  float fA = fract(u);
  float fB = fract(u + 0.5);
  float w = abs(2.0 * fA - 1.0);

  float cloudsA = fbm(vec3(vec2(cos(phi + omega * fA * WIND_CYCLE),
                                sin(phi + omega * fA * WIND_CYCLE)) * (rd * uGrain), lr), lod);
  float cloudsB = fbm(vec3(vec2(cos(phi + omega * fB * WIND_CYCLE),
                                sin(phi + omega * fB * WIND_CYCLE)) * (rd * uGrain), lr + 40.0), lod);
  float clouds = mix(cloudsA, cloudsB, w);

  float filaments = clouds * clouds * 1.75;

  float inner = smoothstep(0.0, 0.07, rn);
  float outer = 1.0 - smoothstep(0.45, 1.0, rn);
  float prof = inner * outer * pow(uDiskIn / rd, 2.0);

  dens = max(0.0, filaments * 1.5 - 0.30) * sheet * prof * uDensity * 4.6;

  heat = pow(uDiskIn / rd, 0.8) * (0.72 + 0.55 * clouds);
  tint = mix(uCool, uMid, smoothstep(0.10, 0.52, heat));
  tint = mix(tint, uHot, smoothstep(0.52, 1.05, heat));
}

vec3 starField(vec3 d) {
  vec3 a = abs(d);
  vec2 uv;
  float face;
  if (a.x >= a.y && a.x >= a.z)      { uv = d.yz / a.x; face = d.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z)               { uv = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; }
  else                               { uv = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; }

  vec3 col = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    float sc = 90.0 * pow(2.2, float(k));
    vec2 p = uv * sc;
    vec2 id = floor(p);
    vec2 f = fract(p) - 0.5;
    float h = hash13(vec3(id, face * 19.0));
    if (h > 0.965) {
      vec2 off = vec2(hash13(vec3(id, face + 11.0)), hash13(vec3(id, face + 23.0)));
      float dd = length(f - (off - 0.5) * 0.7);
      float s = smoothstep(0.055, 0.0, dd);
      float warm = hash13(vec3(id, face + 51.0));
      col += s * (0.6 + 4.5 * fract(h * 97.0))
           * mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.88, 0.72), warm)
           / pow(2.2, float(k));
    }
  }
  
  col += vec3(0.013, 0.017, 0.030) * fbm(d * 2.6, 1.0);
  return col;
}

void main() {

  vec2 uv = (gl_FragCoord.xy + uJitter - uFocus * uRes) / uRes.y;
  vec3 dir = normalize(uFwd + (uv.x * uRight + uv.y * uUp) * 2.0 * uTanHalf);

  vec3 pos = uCamPos;
  vec3 vel = dir;

  vec3 hv = cross(pos, vel);
  float h2 = dot(hv, hv);
  float h = sqrt(h2);
  
  float swept = 0.0;

  vec3 col = vec3(0.0);
  float transmit = 1.0;
  bool captured = false;

  float jitter = fract(sin(dot(gl_FragCoord.xy + uSeed, vec2(12.9898, 78.233))) * 43758.5453);

  for (int i = 0; i < MAX_STEPS; i++) {
    if (float(i) >= uSteps) break;

    float r2 = dot(pos, pos);
    float r = sqrt(r2);

    if (r < 1.0) { captured = true; break; }          
    if (r > uSkyR && dot(pos, vel) > 0.0) break;      
    if (transmit < 0.004) break;                      

    float dt = clamp(0.14 * (r - 1.0), 0.025, 1.1);

    if (r < uDiskOut * 1.25) {
      float rn = clamp((r - uDiskIn) / max(0.001, uDiskOut - uDiskIn), 0.0, 1.0);
      float tk = uThick * (0.35 + 1.25 * rn);
      dt = min(dt, max(tk * 0.38, abs(pos.y) * 0.5));
    }

    swept += h * dt / r2;

    float deep = exp(-1.3 * max(0.0, swept - 4.6));

    jitter = fract(jitter + 0.6180339887);
    vec3 mid = pos + vel * (dt * jitter);
    float rd = length(mid.xz);

    if (rd > uDiskIn && rd < uDiskOut && abs(mid.y) < uThick * 5.0) {
      float dens;
      float heat;
      vec3 tint;
      gasAt(mid, rd, dt, dens, tint, heat);

      if (dens > 0.001) {

        vec3 tang = normalize(cross(vec3(0.0, 1.0, 0.0), vec3(mid.x, 0.0, mid.z)));
        float beta = min(0.85, sqrt(0.5 / max(rd, 1.5)));
        float gam = inversesqrt(max(1e-4, 1.0 - beta * beta));
        vec3 toObs = -normalize(vel);
        float g = 1.0 / (gam * (1.0 - beta * dot(tang, toObs)));
        g *= sqrt(max(0.05, 1.0 - 1.0 / rd));
        float boost = pow(max(g, 0.02), 3.0 * uDoppler);

        vec3 shift = mix(
          vec3(1.0),
          g > 1.0 ? vec3(0.86, 0.94, 1.14) : vec3(1.15, 0.82, 0.62),
          clamp(abs(g - 1.0) * 1.6, 0.0, 1.0) * uDoppler
        );

        float emit = uBright * (0.26 + 2.0 * heat * heat);
        col += tint * shift * (emit * boost * dens * transmit * dt * deep);
        transmit *= exp(-dens * 0.30 * dt);
      }
    }

    vec3 acc = -1.5 * h2 * pos / (r2 * r2 * r);
    vel += acc * dt;
    pos += vel * dt;
  }

  if (!captured && uStars > 0.001) {

    vec3 toHole = normalize(-uCamPos);
    float sI = length(cross(normalize(dir), toHole));
    float sS = length(cross(normalize(vel), toHole));
    float stretch = clamp(sI / max(1e-3, sS), 1.0, 40.0);
    col += starField(normalize(vel)) * uStars * transmit / stretch;
  }

  if (uEncode > 0.5) col = col / (1.0 + col);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const BLEND_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform float uAlpha;

void main() {
  vec3 c = texture2D(uCur, vUv).rgb;
  vec3 p = texture2D(uPrev, vUv).rgb;
  gl_FragColor = vec4(mix(p, c, uAlpha), 1.0);
}
`;

export const BRIGHT_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uDecode;
uniform float uPack;
uniform float uThreshold;

void main() {
  vec3 s = texture2D(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture2D(uTex, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture2D(uTex, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture2D(uTex, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  s *= 0.25;
  if (uDecode > 0.5) s = s / max(vec3(0.002), 1.0 - s);
  float l = max(s.r, max(s.g, s.b));
  s *= max(0.0, l - uThreshold) / max(0.0001, l);
  gl_FragColor = vec4(s * uPack, 1.0);
}
`;

export const BLUR_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uStep;

void main() {
  vec3 s = texture2D(uTex, vUv).rgb * 0.2270270;
  s += (texture2D(uTex, vUv + uStep * 1.3846154).rgb
      + texture2D(uTex, vUv - uStep * 1.3846154).rgb) * 0.3162162;
  s += (texture2D(uTex, vUv + uStep * 3.2307692).rgb
      + texture2D(uTex, vUv - uStep * 3.2307692).rgb) * 0.0702702;
  gl_FragColor = vec4(s, 1.0);
}
`;

export const COMPOSITE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2  uRes;
uniform float uDecode;
uniform float uPack;
uniform float uGlow;
uniform float uExposure;
uniform float uVignette;
uniform float uScrimDir;
uniform float uScrimAmt;
uniform float uSeed;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 scene = texture2D(uScene, vUv).rgb;
  if (uDecode > 0.5) scene = scene / max(vec3(0.002), 1.0 - scene);
  vec3 bloom = texture2D(uBloom, vUv).rgb / uPack;

  vec3 c = scene + bloom * uGlow;
  c = aces(c * uExposure);
  c = pow(max(c, 0.0), vec3(0.4545));

  vec2 d = vUv - 0.5;
  c *= 1.0 - uVignette * dot(d, d) * 1.9;

  if (uScrimDir > 0.5) {
    float x = uScrimDir < 1.5 ? vUv.x
            : uScrimDir < 2.5 ? 1.0 - vUv.x
            : uScrimDir < 3.5 ? 1.0 - vUv.y
            : vUv.y;
    c *= 1.0 - uScrimAmt * pow(1.0 - clamp(x, 0.0, 1.0), 2.4);
  }

  float n = fract(sin(dot(gl_FragCoord.xy + uSeed, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) / 255.0;

  gl_FragColor = vec4(c, 1.0);
}
`;
