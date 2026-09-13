/**
 * WebGL2 video compositor for the analysis canvas.
 *
 * Why WebGL rather than drawImage onto a 2D context: the split-screen mode has
 * to present two decoded videos as one synchronised image, and in 2D that costs
 * a full CPU-side copy of both frames every repaint. Uploading each frame once
 * as a texture and letting the GPU do the compositing keeps stepping responsive
 * while two 720p streams are live, and gives brightness/contrast adjustment for
 * free later - coaches film in bad gym lighting.
 *
 * Annotations are NOT drawn here. They live on a 2D canvas stacked above this
 * one, because crisp text and hairlines are exactly what a 2D context is good at
 * and what WebGL makes needlessly hard.
 */

const VERT = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_brightness;
uniform float u_contrast;
out vec4 outColor;
void main() {
  vec4 c = texture(u_tex, v_uv);
  vec3 rgb = (c.rgb - 0.5) * u_contrast + 0.5 + u_brightness;
  outColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}`;

export type Rect = { x: number; y: number; w: number; h: number };

export type Adjustments = { brightness: number; contrast: number };

/** What both renderers implement, so the component never branches on which. */
export interface FrameRenderer {
  readonly mode: "webgl2" | "2d";
  resize(cssWidth: number, cssHeight: number, dpr: number): { w: number; h: number };
  clear(r?: number, g?: number, b?: number): void;
  draw(
    key: string,
    video: HTMLVideoElement,
    dest: Rect,
    dpr: number,
    adj?: Adjustments,
  ): void;
  dispose(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("Could not create shader");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return sh;
}

export class VideoRenderer implements FrameRenderer {
  readonly mode = "webgl2" as const;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private posBuf: WebGLBuffer;
  private textures = new Map<string, WebGLTexture>();
  private uTex: WebGLUniformLocation | null;
  private uBrightness: WebGLUniformLocation | null;
  private uContrast: WebGLUniformLocation | null;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      premultipliedAlpha: false,
      // The canvas is read back for the "export this frame" feature.
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL2 is not available in this browser");
    this.gl = gl;

    const prog = gl.createProgram();
    if (!prog) throw new Error("Could not create program");
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(prog)}`);
    }
    this.program = prog;

    this.uTex = gl.getUniformLocation(prog, "u_tex");
    this.uBrightness = gl.getUniformLocation(prog, "u_brightness");
    this.uContrast = gl.getUniformLocation(prog, "u_contrast");

    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Could not create VAO");
    this.vao = vao;
    gl.bindVertexArray(vao);

    const posBuf = gl.createBuffer();
    if (!posBuf) throw new Error("Could not create buffer");
    this.posBuf = posBuf;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    // 4 vertices x (clip x, clip y, u, v), filled per draw call.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(16), gl.DYNAMIC_DRAW);

    const aPos = gl.getAttribLocation(prog, "a_pos");
    const aUv = gl.getAttribLocation(prog, "a_uv");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
  }

  private texture(key: string): WebGLTexture {
    let tex = this.textures.get(key);
    if (tex) return tex;
    const gl = this.gl;
    const created = gl.createTexture();
    if (!created) throw new Error("Could not create texture");
    tex = created;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // CLAMP_TO_EDGE + LINEAR: video dimensions are rarely powers of two, and
    // anything else produces a black frame in WebGL rather than an error.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.textures.set(key, tex);
    return tex;
  }

  /** Size the drawing buffer to the element, accounting for device pixel ratio. */
  resize(cssWidth: number, cssHeight: number, dpr: number): { w: number; h: number } {
    const canvas = this.gl.canvas as HTMLCanvasElement;
    // Cap DPR at 2: a 3x phone display triples the fill cost for a difference
    // nobody can see on a video frame.
    const ratio = Math.min(dpr || 1, 2);
    const w = Math.max(1, Math.round(cssWidth * ratio));
    const h = Math.max(1, Math.round(cssHeight * ratio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w, h };
  }

  clear(r = 0.04, g = 0.06, b = 0.08) {
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * Draw a video into `dest`, given in CSS pixels with the origin top-left.
   * `key` identifies the texture so each source keeps its own, rather than the
   * two split-screen videos fighting over one.
   */
  draw(
    key: string,
    video: HTMLVideoElement,
    dest: Rect,
    dpr: number,
    adj: Adjustments = { brightness: 0, contrast: 1 },
  ) {
    const gl = this.gl;
    if (!video.videoWidth || !video.videoHeight) return;

    const ratio = Math.min(dpr || 1, 2);
    const bw = gl.drawingBufferWidth;
    const bh = gl.drawingBufferHeight;

    // CSS pixels (y down) -> clip space (y up).
    const x0 = (dest.x * ratio) / bw * 2 - 1;
    const x1 = ((dest.x + dest.w) * ratio) / bw * 2 - 1;
    const y0 = 1 - (dest.y * ratio) / bh * 2;
    const y1 = 1 - ((dest.y + dest.h) * ratio) / bh * 2;

    // Triangle strip: TL, TR, BL, BR. V is flipped because WebGL's texture
    // origin is bottom-left while a video frame's is top-left.
    const verts = new Float32Array([
      x0, y0, 0, 0,
      x1, y0, 1, 0,
      x0, y1, 0, 1,
      x1, y1, 1, 1,
    ]);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture(key));
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);

    gl.uniform1i(this.uTex, 0);
    gl.uniform1f(this.uBrightness, adj.brightness);
    gl.uniform1f(this.uContrast, adj.contrast);

    gl.viewport(0, 0, bw, bh);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    this.textures.forEach((t) => gl.deleteTexture(t));
    this.textures.clear();
    gl.deleteBuffer(this.posBuf);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);

    // Deliberately NOT calling WEBGL_lose_context.loseContext() here.
    //
    // getContext returns the SAME context object for a canvas every time, so
    // force-losing it poisons the element permanently: the next mount gets the
    // dead context back, createProgram returns null, and the video silently
    // renders as a black rectangle. React remounts this component on every
    // navigation back to a coaching room - and twice on mount in development -
    // so this is the normal path, not an edge case. Dropping our own GPU
    // objects is enough; the context goes with the canvas when it is collected.
  }
}

/**
 * Canvas2D fallback.
 *
 * WebGL2 is not guaranteed: locked-down corporate browsers disable it, some
 * older mobile GPUs are blocklisted by the browser itself, and a lost context
 * can drop it mid-session. Analysis is the product, so it must not vanish
 * because compositing got slower - drawImage handles two 720p panes perfectly
 * well, it just costs a CPU copy per frame.
 */
export class Canvas2DRenderer implements FrameRenderer {
  readonly mode = "2d" as const;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas context available");
    this.ctx = ctx;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number) {
    const canvas = this.ctx.canvas;
    const ratio = Math.min(dpr || 1, 2);
    const w = Math.max(1, Math.round(cssWidth * ratio));
    const h = Math.max(1, Math.round(cssHeight * ratio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w, h };
  }

  clear(r = 0.04, g = 0.06, b = 0.08) {
    const { ctx } = this;
    const to255 = (v: number) => Math.round(v * 255);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgb(${to255(r)},${to255(g)},${to255(b)})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  draw(
    _key: string,
    video: HTMLVideoElement,
    dest: Rect,
    dpr: number,
    adj: Adjustments = { brightness: 0, contrast: 1 },
  ) {
    if (!video.videoWidth || !video.videoHeight) return;
    const { ctx } = this;
    const ratio = Math.min(dpr || 1, 2);
    ctx.save();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // CSS filters are the 2D equivalent of the shader's brightness/contrast.
    if (adj.brightness !== 0 || adj.contrast !== 1) {
      ctx.filter = `brightness(${1 + adj.brightness}) contrast(${adj.contrast})`;
    }
    ctx.drawImage(video, dest.x, dest.y, dest.w, dest.h);
    ctx.restore();
  }

  dispose() {
    /* nothing to release */
  }
}

/**
 * Build the best renderer this browser can give us.
 *
 * Returns the 2D fallback rather than throwing when WebGL2 is unavailable, and
 * reports which one was chosen so the UI can say so honestly instead of
 * pretending it is GPU-composited.
 */
export function createRenderer(canvas: HTMLCanvasElement): {
  renderer: FrameRenderer;
  fallbackReason: string | null;
} {
  // Probe on a THROWAWAY canvas, never on the real one.
  //
  // getContext permanently binds a canvas to the first context type requested,
  // and an unsuccessful request still counts. Asking the live canvas for
  // "webgl2" and missing therefore poisons it: the subsequent "2d" request
  // returns null and the fallback cannot be built at all. Probing elsewhere
  // keeps the real canvas uncommitted until we know which context it will get.
  let probeFailure: string | null = null;
  const probe = document.createElement("canvas");
  try {
    // Build the whole renderer on the probe, not just the context: shader
    // compilation and program linking can fail on drivers that hand out a
    // context quite happily. Only a full success tells us the real canvas is
    // safe to bind to WebGL.
    new VideoRenderer(probe).dispose();
  } catch (err) {
    probeFailure = (err as Error).message;
  }

  if (!probeFailure) {
    try {
      return { renderer: new VideoRenderer(canvas), fallbackReason: null };
    } catch (err) {
      // Context creation succeeded on the probe but shader setup failed here.
      // The real canvas is now bound to webgl2, so a 2D fallback on it is
      // impossible - surface the failure rather than pretending.
      probeFailure = (err as Error).message;
      return { renderer: new NullRenderer(), fallbackReason: probeFailure };
    }
  }

  try {
    return { renderer: new Canvas2DRenderer(canvas), fallbackReason: probeFailure };
  } catch (err) {
    return { renderer: new NullRenderer(), fallbackReason: (err as Error).message };
  }
}

/** Last resort, so a renderer failure never takes the whole page down. */
class NullRenderer implements FrameRenderer {
  readonly mode = "2d" as const;
  resize(cssWidth: number, cssHeight: number, dpr: number) {
    const ratio = Math.min(dpr || 1, 2);
    return { w: Math.round(cssWidth * ratio), h: Math.round(cssHeight * ratio) };
  }
  clear() {}
  draw() {}
  dispose() {}
}
