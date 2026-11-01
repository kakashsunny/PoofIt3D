import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

interface ThreeModelViewerProps {
  src: string;
}

const ThreeModelViewer: React.FC<ThreeModelViewerProps> = ({ src }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<() => void>(() => undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let animationFrame = 0;
    let loadedRoot: THREE.Object3D | null = null;
    let homePosition = new THREE.Vector3(2.8, 2.0, 3.4);
    let homeTarget = new THREE.Vector3(0, 0, 0);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#202823');
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    camera.position.copy(homePosition);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setLoading(false);
      setError('This browser could not create a WebGL viewer.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D model. Drag to rotate, scroll to zoom, right-drag to pan.');
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xf1f5eb, 0x687366, 1.8));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(4, 7, 5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
    fillLight.position.set(-4, 2, -3);
    scene.add(fillLight);
    const grid = new THREE.GridHelper(4, 24, 0x778472, 0x3d4840);
    grid.position.y = -1;
    scene.add(grid);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = true;
    controls.minDistance = 0.2;
    controls.maxDistance = 40;
    controls.target.copy(homeTarget);
    resetRef.current = () => {
      camera.position.copy(homePosition);
      controls.target.copy(homeTarget);
      controls.update();
    };

    const resize = () => {
      if (!host || disposed) return;
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(300, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const loader = new GLTFLoader();
    loader.load(
      src,
      (gltf) => {
        if (disposed) return;
        loadedRoot = gltf.scene;
        scene.add(loadedRoot);
        const bounds = new THREE.Box3().setFromObject(loadedRoot);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const largest = Math.max(size.x, size.y, size.z, 0.1);
        loadedRoot.position.sub(center);
        homeTarget.set(0, 0, 0);
        homePosition.set(largest * 1.7, largest * 1.15, largest * 2.1);
        camera.near = largest / 1000;
        camera.far = largest * 100;
        camera.updateProjectionMatrix();
        resetRef.current();
        setLoading(false);
      },
      undefined,
      () => {
        if (!disposed) {
          setLoading(false);
          setError('The GLB could not be loaded. Check the backend model URL or try the download.');
        }
      },
    );

    const render = () => {
      if (disposed) return;
      animationFrame = window.requestAnimationFrame(render);
      controls.update();
      renderer.render(scene, camera);
    };
    render();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            Object.values(material).forEach((value) => {
              if (value instanceof THREE.Texture) value.dispose();
            });
            material.dispose();
          });
        }
      });
      loadedRoot = null;
    };
  }, [src]);

  return (
    <section className="three-model-viewer" aria-label="3D model viewer">
      <div className="three-model-viewer__toolbar">
        <span>Drag to rotate · scroll to zoom · right-drag to pan</span>
        <button type="button" className="control-button" onClick={() => resetRef.current()} disabled={loading || !!error}>
          Reset camera
        </button>
      </div>
      <div ref={hostRef} className="three-model-viewer__canvas" />
      {loading && <div className="three-model-viewer__message" role="status">Loading textured model…</div>}
      {error && <div className="three-model-viewer__error" role="alert">{error}</div>}
    </section>
  );
};

export default ThreeModelViewer;
