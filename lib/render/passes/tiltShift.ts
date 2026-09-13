import * as THREE from "three";

/**
 * Tilt-shift blur.
 *
 * The pitch is a plane at a fixed tilt, so screen-space Y is very nearly
 * depth — which means a band-limited blur produces the miniature look more
 * convincingly, and far more cheaply, than a real depth-of-field pass. Real
 * DoF on a single plane mostly yields a uniform gradient for several times
 * the cost.
 */
export const TiltShiftShader = {
  name: "TiltShiftShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    /** Screen-space Y that stays sharp. */
    uFocus: { value: 0.55 },
    /** Half-height of the sharp band. */
    uBand: { value: 0.18 },
    uStrength: { value: 2.2 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uFocus;
    uniform float uBand;
    uniform float uStrength;
    varying vec2 vUv;

    void main() {
      float d = abs(vUv.y - uFocus);
      float w = smoothstep(uBand, 1.0, d) * uStrength;

      if (w < 0.01) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      vec2 texel = w / uResolution;
      vec4 sum = texture2D(tDiffuse, vUv) * 0.2;

      // A small ring of taps; enough at this blur radius, and it avoids the
      // cost of a second full-screen pass.
      sum += texture2D(tDiffuse, vUv + vec2( 1.0,  0.0) * texel) * 0.1;
      sum += texture2D(tDiffuse, vUv + vec2(-1.0,  0.0) * texel) * 0.1;
      sum += texture2D(tDiffuse, vUv + vec2( 0.0,  1.0) * texel) * 0.1;
      sum += texture2D(tDiffuse, vUv + vec2( 0.0, -1.0) * texel) * 0.1;
      sum += texture2D(tDiffuse, vUv + vec2( 0.7,  0.7) * texel) * 0.1;
      sum += texture2D(tDiffuse, vUv + vec2(-0.7,  0.7) * texel) * 0.1;
      sum += texture2D(tDiffuse, vUv + vec2( 0.7, -0.7) * texel) * 0.1;
      sum += texture2D(tDiffuse, vUv + vec2(-0.7, -0.7) * texel) * 0.1;

      gl_FragColor = sum;
    }
  `,
};
