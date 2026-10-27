import type { Renderer } from 'pixi.js';

const answers = new WeakMap<object, boolean>();

interface FloatFormat {
  readonly internal: number;
  readonly format: number;
}

/** Whether `gl` can render into a 1x1 texture of this format: it is framebuffer-complete and the draw raises no GL error. */
function rendersTo(gl: WebGL2RenderingContext, { internal, format }: FloatFormat): boolean {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  try {
    if (!texture || !framebuffer) return false;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, 1, 1, 0, format, gl.HALF_FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return false;
    gl.clearColor(0.25, 0.5, 0.75, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return gl.getError() === gl.NO_ERROR;
  } finally {
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    if (texture) gl.deleteTexture(texture);
  }
}

function probe(gl: WebGL2RenderingContext): boolean {
  if (gl.isContextLost()) return false;
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return false;
  // Pixi caches what is bound: put back what was, so the probe is invisible to it.
  const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const texture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const clear = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
  while (gl.getError() !== gl.NO_ERROR) { /* errors raised before the probe are not its */ }
  try {
    return rendersTo(gl, { internal: gl.RGBA16F, format: gl.RGBA }) && rendersTo(gl, { internal: gl.R16F, format: gl.RED });
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.clearColor(clear[0]!, clear[1]!, clear[2]!, clear[3]!);
    while (gl.getError() !== gl.NO_ERROR) { /* the probe's own errors are its answer, already given */ }
  }
}

/**
 * Whether the lighting engine can run on this renderer: WebGL2, float colour buffers, and 1x1
 * `rgba16float` and `r16float` render targets that are framebuffer-complete and draw without a GL
 * error. Any doubt (no WebGL2, a throw) answers false; the answer is kept per renderer.
 */
export function canRunLighting(renderer: Renderer): boolean {
  const known = answers.get(renderer);
  if (known !== undefined) return known;
  let answer = false;
  try {
    const gl = 'gl' in renderer ? (renderer.gl as unknown) : null;
    answer = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext && probe(gl);
  } catch {
    answer = false;
  }
  answers.set(renderer, answer);
  return answer;
}
