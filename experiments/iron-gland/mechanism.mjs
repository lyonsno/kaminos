import { Group, Mesh, BoxGeometry, TorusGeometry, IcosahedronGeometry, MeshBasicMaterial, PointLight, AdditiveBlending } from '../../lib/three.core.js';

export function createMechanism() {
  const root = new Group(); root.name = 'Palm light';
  const chassis = new Group(); root.add(chassis);
  const light = new MeshBasicMaterial({ color: 0x9bfcff, toneMapped: false });
  const glow = new MeshBasicMaterial({ color: 0x20bbd5, transparent: true, opacity: .17, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  const accent = new MeshBasicMaterial({ color: 0xffcc82, toneMapped: false });
  const arcs = [];
  for (let i=0;i<3;i++) {
    const ring = new Group();
    const radius = .48+i*.14, arc = i===0 ? Math.PI*2 : Math.PI*1.55;
    ring.add(new Mesh(new TorusGeometry(radius,.008,6,96,arc),light));
    ring.add(new Mesh(new TorusGeometry(radius,.032,8,96,arc),glow));
    ring.position.z = (i-1)*.12; chassis.add(ring); arcs.push(ring);
  }
  const core = new Mesh(new IcosahedronGeometry(.12,2), light); chassis.add(core);
  const cage = new Mesh(new IcosahedronGeometry(.19,0),new MeshBasicMaterial({color:0x55d9e7,wireframe:true,toneMapped:false}));
  chassis.add(cage);
  const ticks = new Group(); chassis.add(ticks);
  const tick = new BoxGeometry(.006,.055,.006);
  for (let i=0;i<36;i++) {
    const marker = new Mesh(tick,i%9===0?accent:light), angle=i/36*Math.PI*2;
    marker.position.set(Math.sin(angle)*.85,Math.cos(angle)*.85,0); marker.rotation.z=-angle; ticks.add(marker);
  }
  const spill = new PointLight(0x4edbea,.9,3,2); root.add(spill);
  return {
    root,
    update(state, seconds) {
      root.visible = state.visible;
      chassis.rotation.set(...state.rotation);
      for (let i=0;i<arcs.length;i++) {
        const spread=state.openness;
        arcs[i].position.z=(i-1)*(.12+spread*.32);
        arcs[i].rotation.set(i===1?.3+spread*.4:0,i===2?-.35-spread*.5:0,seconds*(i%2?-.16:.12)+i);
      }
      cage.rotation.set(seconds*.25,seconds*.32,0);
      ticks.rotation.z=-seconds*.07;
      ticks.scale.setScalar(1+state.openness*.18);
    },
  };
}
