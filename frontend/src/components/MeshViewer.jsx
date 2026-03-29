import { Suspense, useState, useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Center } from '@react-three/drei';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

function AsyncMesh({ url, fileType }) {
  const [mesh, setMesh] = useState(null);

  useEffect(() => {
    if (!url) return;
    if (fileType === 'stl') {
      const loader = new STLLoader();
      loader.load(url, (geometry) => {
        geometry.computeVertexNormals();
        setMesh({ type: 'buffer', geometry });
      });
    } else {
      const loader = new OBJLoader();
      loader.load(url, (obj) => {
        // Apply material to all children
        obj.traverse((child) => {
          if (child.isMesh) {
            child.material.color.set('#f59e0b');
            child.material.roughness = 0.6;
          }
        });
        setMesh({ type: 'group', object: obj });
      });
    }
  }, [url, fileType]);

  if (!mesh) return null;

  if (mesh.type === 'buffer') {
    return (
      <mesh geometry={mesh.geometry}>
        <meshStandardMaterial color="#f59e0b" roughness={0.6} metalness={0.1} />
      </mesh>
    );
  }

  return <primitive object={mesh.object} />;
}

export default function MeshViewer({ file }) {
  const [meshUrl, setMeshUrl] = useState(null);
  const [fileType, setFileType] = useState('obj');

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setMeshUrl(url);
    setFileType(file.name.split('.').pop().toLowerCase());
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="w-full h-full bg-zinc-950 rounded border border-zinc-800 min-h-[250px]">
      <Canvas
        camera={{ position: [0.03, 0.03, 0.03], fov: 50, near: 0.001, far: 10 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#09090b']} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} />
        <directionalLight position={[-3, -3, 2]} intensity={0.3} />

        {meshUrl ? (
          <Suspense fallback={null}>
            <Center>
              <AsyncMesh url={meshUrl} fileType={fileType} />
            </Center>
          </Suspense>
        ) : (
          <mesh>
            <boxGeometry args={[0.01, 0.01, 0.01]} />
            <meshStandardMaterial color="#3f3f46" wireframe />
          </mesh>
        )}

        <gridHelper args={[0.1, 20, '#27272a', '#1a1a1e']} />
        <OrbitControls enableDamping dampingFactor={0.1} />
      </Canvas>
    </div>
  );
}
