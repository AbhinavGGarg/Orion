import { VERT, SCENE_FRAG, BLEND_FRAG, BRIGHT_FRAG, BLUR_FRAG, COMPOSITE_FRAG } from './blackhole-shaders.js';

const host = document.querySelector('.blackhole-scene');
const canvas = host.querySelector('canvas');
const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });

function startScene() {
  if (!gl) { host.dataset.webgl = 'unavailable'; return; }
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const software = debug && /swiftshader|llvmpipe|software|microsoft basic/i.test(String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)));
  const programs = [], targets = [];
  let frame = 0, last = 0, time = 6, settled = 0, visible = true, width = 0, height = 0;
  let scene, historyA, historyB, bloomA, bloomB;
  let stopped = false;

  function program(fragment) {
    const shaders = [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, fragment]].map(([type, source]) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader); throw new Error('Unable to compile the scene shader');
      }
      return shader;
    });
    const linked = gl.createProgram();
    shaders.forEach(shader => gl.attachShader(linked, shader));
    gl.bindAttribLocation(linked, 0, 'aPos'); gl.linkProgram(linked);
    shaders.forEach(shader => gl.deleteShader(shader));
    if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) throw new Error('Unable to link the scene shader');
    const uniforms = {};
    for (let i = 0; i < gl.getProgramParameter(linked, gl.ACTIVE_UNIFORMS); i++) {
      const name = gl.getActiveUniform(linked, i).name;
      uniforms[name] = gl.getUniformLocation(linked, name);
    }
    const compiled = { linked, uniforms };
    programs.push(compiled);
    return compiled;
  }

  function target(w, h) {
    const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const side of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, side, gl.CLAMP_TO_EDGE);
    for (const filter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, filter, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Unable to allocate the scene');
    const buffer = { texture, framebuffer, w, h };
    targets.push(buffer);
    return buffer;
  }

  const sceneProgram = program(SCENE_FRAG), blend = program(BLEND_FRAG), bright = program(BRIGHT_FRAG);
  const blur = program(BLUR_FRAG), composite = program(COMPOSITE_FRAG);
  const triangle = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, triangle);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);

  function use(prog, buffer, textures = []) {
    gl.useProgram(prog.linked);
    gl.bindFramebuffer(gl.FRAMEBUFFER, buffer?.framebuffer || null);
    gl.viewport(0, 0, buffer?.w || width, buffer?.h || height);
    textures.forEach((texture, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, texture); });
    return prog.uniforms;
  }
  const draw = () => gl.drawArrays(gl.TRIANGLES, 0, 3);
  const halton = [[.5,.333],[.25,.667],[.75,.111],[.125,.444],[.625,.778],[.375,.222],[.875,.556],[.0625,.889]];
  const linear = values => values.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);

  function render() {
    if (stopped || !scene) return;
    const narrow = innerWidth < 760;
    const elevation = -5.5 * Math.PI / 180, roll = -18 * Math.PI / 180, distance = 24;
    const ce = Math.cos(elevation), se = Math.sin(elevation), cr = Math.cos(roll), sr = Math.sin(roll);
    let u = use(sceneProgram, scene);
    gl.uniform2f(u.uRes, scene.w, scene.h); gl.uniform1f(u.uTime, time);
    gl.uniform3f(u.uCamPos, distance * ce, distance * se, 0);
    gl.uniform3f(u.uFwd, -ce, -se, 0);
    gl.uniform3f(u.uRight, -se * sr, ce * sr, cr);
    gl.uniform3f(u.uUp, -se * cr, ce * cr, -sr);
    gl.uniform1f(u.uTanHalf, Math.tan(42 * Math.PI / 360));
    gl.uniform2f(u.uFocus, narrow ? .53 : .7, narrow ? .62 : .51);
    gl.uniform1f(u.uSteps, software ? 150 : narrow ? 220 : 300);
    gl.uniform1f(u.uSkyR, 36); gl.uniform1f(u.uDiskIn, 3); gl.uniform1f(u.uDiskOut, 15);
    gl.uniform1f(u.uThick, .26); gl.uniform1f(u.uDensity, 1); gl.uniform1f(u.uSpin, .06 * Math.PI * 2);
    gl.uniform1f(u.uGrain, .48); gl.uniform1f(u.uBright, 1.1); gl.uniform1f(u.uDoppler, .3);
    gl.uniform3fv(u.uHot, linear([1,.953,.89])); gl.uniform3fv(u.uMid, linear([1,.655,.365]));
    gl.uniform3fv(u.uCool, linear([.43,.24,.15])); gl.uniform1f(u.uStars, .12); gl.uniform1f(u.uEncode, 1);
    const jitter = halton[settled % halton.length];
    gl.uniform2f(u.uJitter, jitter[0] - .5, jitter[1] - .5); gl.uniform1f(u.uSeed, settled % 64 * 17.13);
    draw();
    u = use(blend, historyB, [scene.texture, historyA.texture]);
    gl.uniform1i(u.uCur, 0); gl.uniform1i(u.uPrev, 1); gl.uniform1f(u.uAlpha, settled ? .14 : 1); draw();
    [historyA, historyB] = [historyB, historyA]; settled++;
    u = use(bright, bloomA, [historyA.texture]);
    gl.uniform1i(u.uTex, 0); gl.uniform2f(u.uTexel, 1 / scene.w, 1 / scene.h);
    gl.uniform1f(u.uDecode, 1); gl.uniform1f(u.uPack, .12); gl.uniform1f(u.uThreshold, .85); draw();
    for (const [src, dst, x, y] of [[bloomA,bloomB,1,0],[bloomB,bloomA,0,1],[bloomA,bloomB,2.6,0],[bloomB,bloomA,0,2.6]]) {
      u = use(blur, dst, [src.texture]); gl.uniform1i(u.uTex, 0); gl.uniform2f(u.uStep, x / dst.w, y / dst.h); draw();
    }
    u = use(composite, null, [historyA.texture, bloomA.texture]);
    gl.uniform1i(u.uScene, 0); gl.uniform1i(u.uBloom, 1); gl.uniform2f(u.uRes, width, height);
    gl.uniform1f(u.uDecode, 1); gl.uniform1f(u.uPack, .12); gl.uniform1f(u.uGlow, .3);
    gl.uniform1f(u.uExposure, .9); gl.uniform1f(u.uVignette, .24);
    gl.uniform1f(u.uScrimDir, narrow ? 4 : 1); gl.uniform1f(u.uScrimAmt, .93);
    gl.uniform1f(u.uSeed, time * 60 % 1000); draw();
  }

  function resize() {
    if (stopped) return;
    const rect = host.getBoundingClientRect();
    const scale = software ? .38 : .68;
    width = Math.max(2, Math.round(rect.width * Math.min(devicePixelRatio || 1, 1.25) * scale));
    height = Math.max(2, Math.round(rect.height * Math.min(devicePixelRatio || 1, 1.25) * scale));
    canvas.width = width; canvas.height = height;
    for (const buffer of targets.splice(0)) { gl.deleteTexture(buffer.texture); gl.deleteFramebuffer(buffer.framebuffer); }
    scene = target(width, height); historyA = target(width, height); historyB = target(width, height);
    bloomA = target(Math.max(2, width >> 2), Math.max(2, height >> 2));
    bloomB = target(Math.max(2, width >> 2), Math.max(2, height >> 2));
    settled = 0; render();
  }
  function tick(now) {
    if (stopped || !visible || document.hidden || document.documentElement.dataset.motion === 'off') { frame = 0; last = 0; return; }
    frame = requestAnimationFrame(tick);
    if (now - last < (software ? 85 : 40)) return;
    time += last ? Math.min((now - last) / 1000, .1) : 0;
    last = now; render();
  }
  function resume() {
    cancelAnimationFrame(frame); frame = 0; last = 0;
    if (!stopped && visible && !document.hidden && document.documentElement.dataset.motion !== 'off') frame = requestAnimationFrame(tick);
  }
  const sizeObserver = new ResizeObserver(resize);
  const visibilityObserver = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; resume(); });
  resize();
  for (let i = 0; i < 4; i++) render();
  host.dataset.webgl = 'ready';
  sizeObserver.observe(host); visibilityObserver.observe(host);
  document.addEventListener('polaris:motion', resume);
  document.addEventListener('visibilitychange', resume);
  function dispose() {
    stopped = true; cancelAnimationFrame(frame);
    sizeObserver.disconnect(); visibilityObserver.disconnect();
    document.removeEventListener('polaris:motion', resume);
    document.removeEventListener('visibilitychange', resume);
    for (const buffer of targets) { gl.deleteTexture(buffer.texture); gl.deleteFramebuffer(buffer.framebuffer); }
    for (const prog of programs) gl.deleteProgram(prog.linked);
    gl.deleteBuffer(triangle);
  }
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); dispose(); host.dataset.webgl = 'unavailable'; });
  window.addEventListener('pagehide', dispose, { once: true });
  resume();
}

try { startScene(); } catch { host.dataset.webgl = 'unavailable'; }
