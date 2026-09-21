import * as THREE from 'three/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  float,
  metalness,
  mrt,
  output,
  pass,
  roughness,
  normalView,
  vec4,
  velocity,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { useStore, type QualityMode, type ToneMappingMode } from '../store';

/**
 * The effect stack.
 *
 * `@react-three/postprocessing` and `pmndrs/postprocessing` drive
 * `WebGLRenderer` internals directly and cannot run on a WebGPU canvas, so this
 * is hand-wired from three.js's own post-processing class — `PostProcessing`,
 * renamed to `RenderPipeline` in r186 — composed from the TSL display nodes.
 * That is the single biggest architectural consequence of choosing WebGPU.
 *
 * Every stage is individually guarded: a node that fails to compile degrades
 * the image, it does not blank the viewport.
 */
function buildPipeline(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  quality: QualityMode,
): THREE.RenderPipeline {
  const post = new THREE.RenderPipeline(renderer);

  const scenePass = pass(scene, camera);
  // Four RGBA16F attachments is exactly the 32-bytes-per-sample floor that
  // WebGPU guarantees. Metalness and roughness therefore share one target
  // rather than taking an attachment each — five would be 40 bytes and the
  // render pass is rejected outright on adapters at the baseline limit.
  scenePass.setMRT(
    mrt({
      output,
      normal: normalView,
      material: vec4(metalness, roughness, float(0), float(1)),
      velocity,
    }),
  );

  const colorNode = scenePass.getTextureNode('output');
  const depthNode = scenePass.getTextureNode('depth');
  const normalNode = scenePass.getTextureNode('normal');
  const materialNode = scenePass.getTextureNode('material');
  const velocityNode = scenePass.getTextureNode('velocity');

  let node: any = colorNode;
  const stages: string[] = ['pass'];

  // --- Ambient occlusion: GTAO reads corners far better than SSAO ----------
  try {
    const aoPass = ao(depthNode, normalNode, camera);
    aoPass.resolutionScale = quality === 'high' ? 1 : 0.5;
    aoPass.radius.value = 0.4;
    aoPass.distanceExponent.value = 1.6;
    aoPass.scale.value = 1.1;
    node = node.mul(aoPass.getTextureNode().r);
    stages.push('gtao');
  } catch (error) {
    console.warn('[3xDezine] GTAO unavailable', error);
  }

  // --- Bounce light: the biggest single realism win for an interior --------
  if (quality === 'high') {
    try {
      const giPass = ssgi(colorNode, depthNode, normalNode, camera as THREE.PerspectiveCamera);
      giPass.sliceCount.value = 2;
      giPass.stepCount.value = 8;
      giPass.giIntensity.value = 6;
      giPass.useTemporalFiltering = true;
      node = node.add(giPass.getGINode().mul(colorNode));
      stages.push('ssgi');
    } catch (error) {
      console.warn('[3xDezine] SSGI unavailable', error);
    }
  }

  // --- Floor reflections. drei's MeshReflectorMaterial is broken under
  //     WebGPU and was closed as "not planned", so this is the route. --------
  try {
    // The addon's declared normal type is vec3; a pass texture node is vec4.
    const ssrPass = ssr(colorNode, depthNode, normalNode as never, {
      metalnessNode: materialNode.r,
      roughnessNode: materialNode.g,
      reflectNonMetals: true,
      camera,
    });
    node = node.add(ssrPass.mul(0.5));
    stages.push('ssr');
  } catch (error) {
    console.warn('[3xDezine] SSR unavailable', error);
  }

  // --- Anti-aliasing -------------------------------------------------------
  try {
    node = traa(node, depthNode, velocityNode, camera);
    stages.push('traa');
  } catch (error) {
    console.warn('[3xDezine] TRAA unavailable', error);
  }

  // --- A restrained bloom; interiors do not want a glow filter -------------
  try {
    node = node.add(bloom(node, 0.11, 0.55, 0.92));
    stages.push('bloom');
  } catch (error) {
    console.warn('[3xDezine] Bloom unavailable', error);
  }

  post.outputNode = node;
  console.info(`[3xDezine] post stack: ${stages.join(' → ')}`);
  return post;
}

const TONE_MAPPING: Record<ToneMappingMode, THREE.ToneMapping> = {
  // AgX rolls off blown-out window highlights, the characteristic interior
  // failure case. ACES Filmic is deliberately not the default: it desaturates.
  AGX: THREE.AgXToneMapping,
  NEUTRAL: THREE.NeutralToneMapping,
};

export function PostFX({
  quality,
  toneMapping,
  exposure,
}: {
  quality: QualityMode;
  toneMapping: ToneMappingMode;
  exposure: number;
}) {
  const gl = useThree((state) => state.gl) as unknown as THREE.WebGPURenderer;
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const failed = useRef(false);
  const presented = useRef(false);
  const setRendererReady = useStore((s) => s.setRendererReady);

  useEffect(() => {
    gl.toneMapping = TONE_MAPPING[toneMapping];
    gl.toneMappingExposure = exposure;
  }, [gl, toneMapping, exposure]);

  const post = useMemo(() => {
    if (quality === 'performance') return null;
    try {
      failed.current = false;
      return buildPipeline(gl, scene, camera, quality);
    } catch (error) {
      console.error('[3xDezine] post-processing pipeline failed to build', error);
      return null;
    }
  }, [gl, scene, camera, quality]);

  useEffect(
    () => () => {
      post?.dispose?.();
    },
    [post],
  );

  // Priority > 0 takes the render loop away from R3F's default renderer.
  useFrame(() => {
    try {
      if (post && !failed.current) post.render();
      else gl.render(scene, camera);
      if (!presented.current) {
        presented.current = true;
        setRendererReady();
      }
    } catch (error) {
      if (!failed.current) {
        failed.current = true;
        console.error('[3xDezine] post-processing render failed, falling back', error);
      }
    }
  }, 1);

  return null;
}
