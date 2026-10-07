/* ============================================================
 * Frozen — ambient WebGL background  (js/bg.js)
 *
 * Fullscreen-quad fragment shader: five colour masses orbit slowly
 * through a domain-warped noise field, so blob boundaries billow
 * instead of staying circular. Rendered into a low-res FBO, then
 * composited at full res with animated grain + dither to kill
 * banding. Two passes keeps it at 60fps on weak GPUs: the expensive
 * pass runs at ~42% resolution (the content is all soft anyway)
 * and the composite pass is a texture sample + one hash.
 *
 * Fallback chain: WebGL2 -> WebGL1 -> .bg-static CSS gradient
 * (defined in css/pages/bg.css).
 *
 * Public surface (used by nothing, safe to ignore):
 *   window.FrozenBG = { pause(), resume(), renderOnce() }
 * ============================================================ */
(() => {
  'use strict';

  var canvas = document.getElementById('bg');
  if (!canvas) return;

  var GL_OPTS = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power'
  };

  var gl = canvas.getContext('webgl2', GL_OPTS) ||
           canvas.getContext('webgl', GL_OPTS) ||
           canvas.getContext('experimental-webgl', GL_OPTS);

  /* static fallback — class hooks css/pages/bg.css; inline style is
   * the same recipe so it works even before that link is wired. */
  function fallback(){
    canvas.classList.add('bg-static');
    canvas.style.background =
      'radial-gradient(75% 65% at 30% 32%, rgba(139,108,255,.34), rgba(139,108,255,0) 62%),' +
      'radial-gradient(60% 70% at 8% 78%,  rgba(74,51,216,.30),  rgba(74,51,216,0) 64%),' +
      'radial-gradient(55% 60% at 96% 22%, rgba(255,92,138,.30), rgba(255,92,138,0) 66%),' +
      'radial-gradient(45% 45% at 99% 62%, rgba(255,157,92,.20), rgba(255,157,92,0) 68%),' +
      '#0b0817';
  }

  if (!gl) {
    fallback();
    return;
  }

  /* ---- tunables ------------------------------------------- */
  var DPR_CAP      = 1.5;   // spec: cap devicePixelRatio
  var RENDER_SCALE = 0.42;  // gradient pass resolution factor
  var SPEED        = 1.0;   // global time multiplier
  /* ---------------------------------------------------------- */

  var VERT =
    'attribute vec2 a_pos;' +
    'void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }';

  /* Pass 1 — the gradient itself, evaluated on a small target.
   * Palette anchors: base #0b0817, violet #8b6cff, pink #ff5c8a,
   * orange #ff9d5c (warm accents kept toward edges/corners). */
  var FRAG_GRADIENT = [
    'precision highp float;',
    'uniform vec2  u_res;',
    'uniform float u_time;',
    '',
    'vec2 hash22(vec2 p){',
    '  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));',
    '  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);',
    '}',
    '',
    'float snoise(vec2 p){',
    '  const float K1 = 0.366025404;',
    '  const float K2 = 0.211324865;',
    '  vec2 i = floor(p + (p.x + p.y) * K1);',
    '  vec2 a = p - i + (i.x + i.y) * K2;',
    '  vec2 o = (a.x > a.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);',
    '  vec2 b = a - o + K2;',
    '  vec2 c = a - 1.0 + 2.0 * K2;',
    '  vec3 h = max(0.5 - vec3(dot(a,a), dot(b,b), dot(c,c)), 0.0);',
    '  vec3 n = h*h*h*h * vec3(dot(a, hash22(i)), dot(b, hash22(i+o)), dot(c, hash22(i+1.0)));',
    '  return dot(n, vec3(70.0));',
    '}',
    '',
    'float fbm(vec2 p){',
    '  float v = 0.0;',
    '  float a = 0.5;',
    '  for (int i = 0; i < 3; i++){',
    '    v += a * snoise(p);',
    '    p = p * 2.03 + vec2(1.7, 9.2);',
    '    a *= 0.5;',
    '  }',
    '  return v;',
    '}',
    '',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / u_res;',
    '  vec2 st = uv - 0.5;',
    '  st.x *= u_res.x / u_res.y;',
    '  float t = u_time;',
    '',
    '  /* slow churn — warps every blob boundary at once */',
    '  vec2 wuv = st * 1.15;',
    '  float w1 = fbm(wuv + vec2(0.0, t * 0.014));',
    '  float w2 = fbm(wuv * 1.3 + vec2(5.2, 1.3) - vec2(t * 0.011, 0.0));',
    '  vec2 w = st + 0.44 * vec2(w1, w2);',
    '',
    '  /* orbiting mass centres — Lissajous drift, ~18-30s cycles */',
    '  vec2 cViolet = vec2(-0.26 + 0.16*sin(t*0.21 + 0.6),  0.26 + 0.10*sin(t*0.13 + 2.1));',
    '  vec2 cTop    = vec2( 0.02 + 0.11*sin(t*0.08 + 3.0),  0.95 + 0.05*sin(t*0.10 + 0.8));',
    '  vec2 cIndigo = vec2(-0.42 + 0.10*sin(t*0.09 + 4.0), -0.16 + 0.12*sin(t*0.16 + 1.0));',
    '  vec2 cPink   = vec2( 0.70 + 0.08*sin(t*0.17 + 3.4),  0.30 + 0.13*sin(t*0.11 + 5.2));',
    '  vec2 cOrange = vec2( 0.60 + 0.12*sin(t*0.12 + 1.9), -0.18 + 0.10*sin(t*0.19 + 3.8));',
    '',
    '  vec3 BASE   = vec3(0.043, 0.031, 0.090);',
    '  vec3 VIOLET = vec3(0.500, 0.400, 1.000);',
    '  vec3 INDIGO = vec3(0.290, 0.200, 0.780);',
    '  vec3 PINK   = vec3(1.000, 0.330, 0.520);',
    '  vec3 ORANGE = vec3(1.000, 0.616, 0.361);',
    '',
    '  /* gentle intensity breathing so nothing holds a fixed pose */',
    '  float bV = 0.44 + 0.08*sin(t*0.10);',
    '  float bI = 0.40 + 0.07*sin(t*0.07 + 2.0);',
    '  float bP = 0.74 + 0.08*sin(t*0.14 + 1.0);',
    '  float bO = 0.34 + 0.09*sin(t*0.12 + 3.0);',
    '',
    '  vec2 dV = w - cViolet;',
    '  vec2 dT = w - cTop;',
    '  vec2 dI = w - cIndigo;',
    '  vec2 dP = w - cPink;',
    '  vec2 dO = w - cOrange;',
    '',
    '  vec3 cool = VIOLET * bV * exp(-dot(dV, dV) * 5.5)',
    '            + INDIGO * bI * exp(-dot(dI, dI) * 8.0)',
    '            + vec3(0.42, 0.38, 1.0) * (0.17 + 0.05*sin(t*0.09 + 1.4)) * exp(-dot(dT, dT) * 6.0);',
    '  vec3 warm = PINK   * bP * exp(-dot(dP, dP) * 17.0)',
    '            + ORANGE * bO * exp(-dot(dO, dO) * 24.0);',
    '',
    '  /* pull hot accents down near the middle — keep text readable */',
    '  warm *= mix(0.62, 1.0, smoothstep(0.08, 0.60, length(st)));',
    '',
    '  vec3 col = BASE + cool + warm;',
    '  col = 1.0 - exp(-col * 1.15);          /* soft highlight rolloff */',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* Pass 2 — full-res composite: sample the soft gradient, add
   * animated photographic grain + sub-LSB dither to kill banding. */
  var FRAG_COMPOSITE = [
    'precision mediump float;',
    'uniform sampler2D u_tex;',
    'uniform vec2  u_res;',
    'uniform float u_time;',
    '',
    'float hash12(vec2 p){',
    '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}',
    '',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / u_res;',
    '  vec3 c = texture2D(u_tex, uv).rgb;',
    '  float ft = floor(u_time * 24.0);            /* film-rate grain */',
    '  float g = hash12(gl_FragCoord.xy + ft * 173.0);',
    '  c += (g - 0.5) * 0.030;',
    '  c += (hash12(gl_FragCoord.xy * 1.37 + 71.0) - 0.5) * (2.0 / 255.0);',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  /* ---- GL plumbing ---------------------------------------- */
  function compile(type, src){
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('bg shader: ' + log);
    }
    return s;
  }

  function program(vs, fs){
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('bg link: ' + gl.getProgramInfoLog(p));
    }
    return p;
  }

  var progGrad, progComp;
  try {
    progGrad = program(VERT, FRAG_GRADIENT);
    progComp = program(VERT, FRAG_COMPOSITE);
  } catch (e) {
    fallback();
    return;
  }

  /* fullscreen triangle */
  var vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  var loc = {
    grad: {
      pos:  gl.getAttribLocation(progGrad, 'a_pos'),
      res:  gl.getUniformLocation(progGrad, 'u_res'),
      time: gl.getUniformLocation(progGrad, 'u_time')
    },
    comp: {
      pos:  gl.getAttribLocation(progComp, 'a_pos'),
      res:  gl.getUniformLocation(progComp, 'u_res'),
      time: gl.getUniformLocation(progComp, 'u_time'),
      tex:  gl.getUniformLocation(progComp, 'u_tex')
    }
  };

  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  var fbo = gl.createFramebuffer();
  var fboW = 0, fboH = 0;
  var running = false, rafId = 0, start = performance.now(), timeOffset = 0;

  function bindQuad(l){
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(l.pos);
    gl.vertexAttribPointer(l.pos, 2, gl.FLOAT, false, 0, 0);
  }

  function resize(){
    var dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    var w = Math.max(1, Math.round(canvas.clientWidth  * dpr));
    var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width === w && canvas.height === h && fboW) return;
    canvas.width = w;
    canvas.height = h;
    fboW = Math.max(96, Math.round(w * RENDER_SCALE));
    fboH = Math.max(54, Math.round(h * RENDER_SCALE));
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fboW, fboH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function draw(t){
    /* pass 1: gradient -> fbo */
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, fboW, fboH);
    gl.useProgram(progGrad);
    bindQuad(loc.grad);
    gl.uniform2f(loc.grad.res, fboW, fboH);
    gl.uniform1f(loc.grad.time, t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* pass 2: composite -> screen */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(progComp);
    bindQuad(loc.comp);
    gl.uniform2f(loc.comp.res, canvas.width, canvas.height);
    gl.uniform1f(loc.comp.time, t);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc.comp.tex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  var reducedMotion = false;
  try {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}

  function tick(now){
    if (!running) return;
    draw(timeOffset + (now - start) / 1000 * SPEED);
    rafId = requestAnimationFrame(tick);
  }

  function play(){
    if (running || reducedMotion) { renderOnce(); return; }
    running = true;
    start = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function pause(){
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    /* freeze accumulated time so resume continues the same scene */
    timeOffset += (performance.now() - start) / 1000 * SPEED;
  }

  function renderOnce(){
    resize();
    draw(timeOffset + (performance.now() - start) / 1000 * SPEED);
  }

  /* ---- lifecycle ------------------------------------------- */
  document.addEventListener('visibilitychange', function(){
    if (document.hidden) pause();
    else play();
  });

  var resizeTimer = 0;
  function onResize(){
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function(){
      resize();
      if (!running) renderOnce();
    }, 120);
  }
  window.addEventListener('resize', onResize);

  canvas.addEventListener('webglcontextlost', function(e){
    e.preventDefault();
    pause();
  }, false);
  canvas.addEventListener('webglcontextrestored', function(){
    /* textures/programs are gone; simplest correct recovery is a
     * static fallback until next navigation. */
    fallback();
  }, false);

  window.FrozenBG = { pause: pause, resume: play, renderOnce: renderOnce };

  resize();
  if (reducedMotion) renderOnce();
  else play();
})();
