import { useEffect, useRef } from 'react'

/* Ambient WebGL shader-gradient background — same 2-pass pipeline as the
 * previous bg.js: 5 noise-warped colour masses at ~42% res, composited
 * full-res with animated grain + dither. Tuned darker for this UI. */

const GL_OPTS: WebGLContextAttributes = {
  alpha: false, antialias: false, depth: false, stencil: false,
  preserveDrawingBuffer: false, powerPreference: 'low-power',
}
const DPR_CAP = 1.5
const RENDER_SCALE = 0.42
const SPEED = 1.0

const VERT = 'attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0.0,1.0);}'

const FRAG_GRADIENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
vec2 hash22(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return -1.0+2.0*fract(sin(p)*43758.5453123);}
float snoise(vec2 p){
  const float K1=0.366025404;const float K2=0.211324865;
  vec2 i=floor(p+(p.x+p.y)*K1);vec2 a=p-i+(i.x+i.y)*K2;
  vec2 o=(a.x>a.y)?vec2(1.0,0.0):vec2(0.0,1.0);
  vec2 b=a-o+K2;vec2 c=a-1.0+2.0*K2;
  vec3 h=max(0.5-vec3(dot(a,a),dot(b,b),dot(c,c)),0.0);
  vec3 n=h*h*h*h*vec3(dot(a,hash22(i)),dot(b,hash22(i+o)),dot(c,hash22(i+1.0)));
  return dot(n,vec3(70.0));
}
float fbm(vec2 p){float v=0.0;float a=0.5;for(int i=0;i<3;i++){v+=a*snoise(p);p=p*2.03+vec2(1.7,9.2);a*=0.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/u_res;
  vec2 st=uv-0.5;st.x*=u_res.x/u_res.y;
  float t=u_time;
  vec2 wuv=st*1.15;
  float w1=fbm(wuv+vec2(0.0,t*0.014));
  float w2=fbm(wuv*1.3+vec2(5.2,1.3)-vec2(t*0.011,0.0));
  vec2 w=st+0.44*vec2(w1,w2);
  vec2 cViolet=vec2(-0.26+0.16*sin(t*0.21+0.6),0.26+0.10*sin(t*0.13+2.1));
  vec2 cTop=vec2(0.02+0.11*sin(t*0.08+3.0),0.95+0.05*sin(t*0.10+0.8));
  vec2 cIndigo=vec2(-0.42+0.10*sin(t*0.09+4.0),-0.16+0.12*sin(t*0.16+1.0));
  vec2 cPink=vec2(0.70+0.08*sin(t*0.17+3.4),0.30+0.13*sin(t*0.11+5.2));
  vec2 cOrange=vec2(0.60+0.12*sin(t*0.12+1.9),-0.18+0.10*sin(t*0.19+3.8));
  vec3 BASE=vec3(0.035,0.035,0.045);
  vec3 VIOLET=vec3(0.40,0.32,0.85);
  vec3 INDIGO=vec3(0.24,0.16,0.66);
  vec3 PINK=vec3(0.80,0.26,0.42);
  vec3 ORANGE=vec3(0.85,0.52,0.30);
  float bV=0.34+0.06*sin(t*0.10);
  float bI=0.30+0.05*sin(t*0.07+2.0);
  float bP=0.50+0.06*sin(t*0.14+1.0);
  float bO=0.24+0.07*sin(t*0.12+3.0);
  vec2 dV=w-cViolet;vec2 dT=w-cTop;vec2 dI=w-cIndigo;vec2 dP=w-cPink;vec2 dO=w-cOrange;
  vec3 cool=VIOLET*bV*exp(-dot(dV,dV)*5.5)
          +INDIGO*bI*exp(-dot(dI,dI)*8.0)
          +vec3(0.34,0.30,0.85)*(0.13+0.04*sin(t*0.09+1.4))*exp(-dot(dT,dT)*6.0);
  vec3 warm=PINK*bP*exp(-dot(dP,dP)*17.0)
          +ORANGE*bO*exp(-dot(dO,dO)*24.0);
  warm*=mix(0.55,1.0,smoothstep(0.08,0.60,length(st)));
  vec3 col=BASE+cool+warm;
  col=1.0-exp(-col*1.0);
  gl_FragColor=vec4(col,1.0);
}`

const FRAG_COMPOSITE = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_time;
float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
void main(){
  vec2 uv=gl_FragCoord.xy/u_res;
  vec3 c=texture2D(u_tex,uv).rgb;
  float ft=floor(u_time*24.0);
  float g=hash12(gl_FragCoord.xy+ft*173.0);
  c+=(g-0.5)*0.028;
  c+=(hash12(gl_FragCoord.xy*1.37+71.0)-0.5)*(2.0/255.0);
  gl_FragColor=vec4(c,1.0);
}`

export function GradientBg() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const gl = (canvas.getContext('webgl2', GL_OPTS) ||
      canvas.getContext('webgl', GL_OPTS) ||
      canvas.getContext('experimental-webgl', GL_OPTS)) as WebGLRenderingContext | null

    const fallback = () => {
      canvas.style.background =
        'radial-gradient(75% 65% at 30% 32%, rgba(124,108,240,.22), transparent 62%),' +
        'radial-gradient(60% 70% at 8% 78%, rgba(74,51,216,.18), transparent 64%),' +
        'radial-gradient(55% 60% at 96% 22%, rgba(200,80,120,.16), transparent 66%),#09090b'
    }
    if (!gl) { fallback(); return }

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader')
      return s
    }
    const program = (vs: string, fs: string) => {
      const p = gl.createProgram()!
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs))
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs))
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link')
      return p
    }
    let progGrad: WebGLProgram, progComp: WebGLProgram
    try {
      progGrad = program(VERT, FRAG_GRADIENT)
      progComp = program(VERT, FRAG_COMPOSITE)
    } catch {
      fallback(); return
    }

    const vbo = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

    const loc = {
      grad: { pos: gl.getAttribLocation(progGrad, 'a_pos'), res: gl.getUniformLocation(progGrad, 'u_res'), time: gl.getUniformLocation(progGrad, 'u_time') },
      comp: { pos: gl.getAttribLocation(progComp, 'a_pos'), res: gl.getUniformLocation(progComp, 'u_res'), time: gl.getUniformLocation(progComp, 'u_time'), tex: gl.getUniformLocation(progComp, 'u_tex') },
    }
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()
    let fboW = 0, fboH = 0, running = false, rafId = 0
    let start = performance.now(), timeOffset = 0

    const bindQuad = (l: { pos: number }) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
      gl.enableVertexAttribArray(l.pos)
      gl.vertexAttribPointer(l.pos, 2, gl.FLOAT, false, 0, 0)
    }
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width === w && canvas.height === h && fboW) return
      canvas.width = w; canvas.height = h
      fboW = Math.max(96, Math.round(w * RENDER_SCALE)); fboH = Math.max(54, Math.round(h * RENDER_SCALE))
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fboW, fboH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    }
    const draw = (t: number) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.viewport(0, 0, fboW, fboH)
      gl.useProgram(progGrad); bindQuad(loc.grad)
      gl.uniform2f(loc.grad.res, fboW, fboH); gl.uniform1f(loc.grad.time, t)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.useProgram(progComp); bindQuad(loc.comp)
      gl.uniform2f(loc.comp.res, canvas.width, canvas.height); gl.uniform1f(loc.comp.time, t)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc.comp.tex, 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    const tick = (now: number) => {
      if (!running) return
      draw(timeOffset + ((now - start) / 1000) * SPEED)
      rafId = requestAnimationFrame(tick)
    }
    const play = () => { if (!running) { running = true; start = performance.now(); rafId = requestAnimationFrame(tick) } }
    const pause = () => {
      running = false
      if (rafId) cancelAnimationFrame(rafId)
      rafId = 0
      timeOffset += ((performance.now() - start) / 1000) * SPEED
    }
    const onVis = () => (document.hidden ? pause() : play())
    let rt = 0
    const onResize = () => { clearTimeout(rt); rt = window.setTimeout(() => { resize(); if (!running) draw(timeOffset) }, 120) as unknown as number }
    const onLost = (e: Event) => { e.preventDefault(); pause() }
    const onRestored = () => fallback()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('resize', onResize)
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    resize()
    if (reduced) draw(0); else play()

    return () => {
      pause()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('resize', onResize)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [])

  return (
    <>
      <canvas ref={ref} className="fixed inset-0 -z-20 h-full w-full" />
      {/* dark tint to keep text legible */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[#09090b]/60 backdrop-blur-[1px]" />
    </>
  )
}
