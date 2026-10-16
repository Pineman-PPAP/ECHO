import * as THREE from 'three';

let shared: {
  body: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  eye: THREE.BufferGeometry;
} | null = null;

/** Geometries are shared by every monster figure (afterimage pool + jumpscare). Never dispose them. */
function geometries() {
  shared ??= {
    body: new THREE.CylinderGeometry(0.16, 0.26, 1.5, 8, 1, true),
    head: new THREE.SphereGeometry(0.2, 10, 8),
    arm: new THREE.CylinderGeometry(0.035, 0.05, 1.45, 6),
    leg: new THREE.CylinderGeometry(0.05, 0.04, 0.6, 6),
    eye: new THREE.SphereGeometry(0.045, 8, 6),
  };
  return shared;
}

/**
 * A tall, thin "Hollow": about 2.2 m high, long arms hanging to the knees, two eye dots.
 * Origin at its feet; it FACES +z (the eyes are on the +z side), so rotation.y = atan2(dx, dz)
 * turns it to face the direction (dx, dz).
 */
export function createMonsterModel(bodyMaterial: THREE.Material, eyeMaterial: THREE.Material): THREE.Group {
  const g = geometries();
  const group = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.z = rz;
    group.add(m);
    return m;
  };
  add(g.body, bodyMaterial, 0, 1.05, 0);
  add(g.head, bodyMaterial, 0, 2.0, 0).scale.set(0.9, 1.15, 0.9);
  add(g.arm, bodyMaterial, -0.3, 1.15, 0.02, 0.12);
  add(g.arm, bodyMaterial, 0.3, 1.15, 0.02, -0.12);
  add(g.leg, bodyMaterial, -0.1, 0.3, 0);
  add(g.leg, bodyMaterial, 0.1, 0.3, 0);
  add(g.eye, eyeMaterial, -0.07, 2.03, 0.17);
  add(g.eye, eyeMaterial, 0.07, 2.03, 0.17);
  return group;
}
