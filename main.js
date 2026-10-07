import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';

const CPK = { H: 0xf2f2f2, C: 0x8c8c8c, N: 0x3050f8, O: 0xff2a2a };
const CPK_CSS = { H: '#f2f2f2', C: '#8c8c8c', N: '#3050f8', O: '#ff2a2a' };
const EL_ZH = { H: '氢', C: '碳', N: '氮', O: '氧' };
const BOND_BASE = 0x9a9a9a;          // 棍子默认灰
const BALL_R = 0.62;                 // 球棍模式原子球基准半径（Å）
const STICK_R = 0.16;                // 棍子基准半径（Å）

// ---------- state ----------
const state = {
  style: 'ballstick',                // spacefill | ballstick | sticks（默认球棍）
  sphereScale: 1, stickScale: 1, gap: 0.15,
  showH: true,
  selection: new Set(),              // 'a<idx>' 原子 / 'b<idx>' 键
};

// ---------- renderer / scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
// 轨迹球控制器：真正的全自由度旋转，无俯仰/方位角限制，
// 任意朝向都可达，可连续翻滚（720° 只是起步），也不会在两极处翻转卡顿
const controls = new TrackballControls(camera, canvas);
controls.staticMoving = true;        // 拖拽跟手，无惯性漂移
controls.rotateSpeed = 2.4;          // 旋转灵敏度

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(6, 10, 8);
scene.add(key);
const fill = new THREE.DirectionalLight(0x9db8ff, 0.5);
fill.position.set(-8, -4, -6);
scene.add(fill);

const molGroup = new THREE.Group();   // 原子球
const bondGroup = new THREE.Group();  // 棍子 + 命中代理
const haloGroup = new THREE.Group();  // 选中高亮
// 三个组放进同一个父组，整体设置初始朝向（参考图：长轴水平、侧链向右上）
const modelGroup = new THREE.Group();
modelGroup.add(molGroup, bondGroup, haloGroup);
modelGroup.rotation.order = 'YXZ';
modelGroup.rotation.y = THREE.MathUtils.degToRad(170);
modelGroup.rotation.x = THREE.MathUtils.degToRad(10);
scene.add(modelGroup);

const sphereGeo = new THREE.SphereGeometry(1, 40, 28);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1);

// ---------- load molecule ----------
const data = await (await fetch('taxol.json')).json();

const centroid = new THREE.Vector3();
data.atoms.forEach(a => centroid.add(new THREE.Vector3(a.x, a.y, a.z)));
centroid.divideScalar(data.atoms.length);

const atomPos = [];
const atomMeshes = [];
for (const a of data.atoms) {
  const p = new THREE.Vector3(a.x - centroid.x, a.y - centroid.y, a.z - centroid.z);
  atomPos.push(p);
  const mesh = new THREE.Mesh(sphereGeo, new THREE.MeshPhongMaterial({
    color: CPK[a.el], shininess: 60, specular: 0x333333,
  }));
  mesh.position.copy(p);
  mesh.userData = { key: 'a' + a.i, kind: 'atom', el: a.el, vdw: a.r, base: CPK[a.el] };
  molGroup.add(mesh);
  atomMeshes.push(mesh);
}

const maxR = Math.max(...atomMeshes.map(m => m.position.length() + m.userData.vdw));
camera.position.set(0, 0, maxR * 2.6);
controls.maxDistance = maxR * 8;
controls.minDistance = maxR * 0.25;   // 允许贴近观察任意局部

// ---------- 构建 / 重建 ----------
function atomRadius(mesh) {
  const base = state.style === 'spacefill' ? mesh.userData.vdw : BALL_R;
  return base * state.sphereScale;
}

function rebuildBonds(curPos) {
  // 清理旧棍子
  for (const c of [...bondGroup.children]) {
    bondGroup.remove(c);
    if (c.userData.ownMat) c.userData.ownMat.dispose();
    if (c.userData.proxyMat) c.userData.proxyMat.dispose();
  }

  data.bonds.forEach((bd, k) => {
    const ma = atomMeshes[bd.a], mb = atomMeshes[bd.b];
    if (ma.userData.el === 'H' && !state.showH) return;
    if (mb.userData.el === 'H' && !state.showH) return;
    if (state.style === 'spacefill') return;   // 空间填充不画键

    const p1 = curPos[bd.a], p2 = curPos[bd.b];
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();
    dir.normalize();

    // 球棍模式：棍子两端让出原子球（球体已随间距沿键方向移动）
    const trim = state.style === 'ballstick'
      ? Math.min(atomRadius(ma), len * 0.45) : 0;
    const segLen = Math.max(len - 2 * trim, 0.05);
    const start = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5)
      .addScaledVector(dir, -segLen / 2);

    const r = STICK_R * state.stickScale * (bd.o >= 2 ? 1.25 : 1);
    const mat = new THREE.MeshPhongMaterial({
      color: BOND_BASE, shininess: 40, specular: 0x222222,
    });
    const cyl = new THREE.Mesh(cylGeo, mat);
    cyl.scale.set(r, segLen, r);
    cyl.position.copy(start).addScaledVector(dir, segLen / 2);
    cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    cyl.userData = { key: 'b' + k, kind: 'bond', base: BOND_BASE, ownMat: mat };

    // 不可见粗柱体，方便点选细棍
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    const proxy = new THREE.Mesh(cylGeo, proxyMat);
    proxy.scale.set(Math.max(r, 0.34), segLen, Math.max(r, 0.34));
    proxy.position.copy(cyl.position);
    proxy.quaternion.copy(cyl.quaternion);
    proxy.userData = { key: 'b' + k, kind: 'bond', base: BOND_BASE,
                       ownMat: mat, proxyMat, isProxy: true };

    bondGroup.add(cyl, proxy);
  });
}

function rebuild() {
  // 间距：球棍模式下原子沿化学键方向拉开 state.gap（每端 gap），
  // 球与球之间的距离随棍子一起变化；其他模式回到原始坐标
  const g = state.style === 'ballstick' ? state.gap : 0;
  const disp = atomPos.map(() => new THREE.Vector3());
  if (g > 0) {
    for (const bd of data.bonds) {
      const dir = new THREE.Vector3().subVectors(atomPos[bd.b], atomPos[bd.a]);
      if (dir.lengthSq() < 1e-12) continue;
      dir.normalize();
      disp[bd.a].addScaledVector(dir, -g);
      disp[bd.b].addScaledVector(dir, g);
    }
  }
  const curPos = atomPos.map((p, i) => p.clone().add(disp[i]));

  // 原子球：位置 / 半径 / 可见性
  atomMeshes.forEach((m, i) => {
    const isH = m.userData.el === 'H';
    m.visible = state.style !== 'sticks' && (!isH || state.showH);
    m.position.copy(curPos[i]);
    m.scale.setScalar(atomRadius(m));
  });
  rebuildBonds(curPos);
  refreshHighlight();
  refreshSelInfo();
}

function refreshHighlight() {
  haloGroup.clear();
  for (const key of state.selection) {
    if (key[0] === 'a') {
      const m = atomMeshes[+key.slice(1)];
      if (!m.visible) continue;
      const halo = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, wireframe: true, transparent: true, opacity: 0.4,
      }));
      halo.position.copy(m.position);
      halo.scale.setScalar(m.scale.x * 1.1);
      haloGroup.add(halo);
    } else {
      const proxy = bondGroup.children.find(c => c.userData.key === key && c.userData.isProxy);
      if (!proxy) continue;
      const halo = new THREE.Mesh(cylGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5,
      }));
      halo.scale.copy(proxy.scale).multiplyScalar(1.15);
      halo.position.copy(proxy.position);
      halo.quaternion.copy(proxy.quaternion);
      haloGroup.add(halo);
    }
  }
}

// ---------- UI：模式切换 ----------
const tabs = document.querySelectorAll('.tab');
tabs.forEach(t => t.addEventListener('click', () => {
  tabs.forEach(x => x.classList.toggle('active', x === t));
  state.style = t.dataset.style;
  // 滑块可用性
  document.getElementById('rowSphere').classList.toggle('disabled', state.style === 'sticks');
  document.getElementById('rowStick').classList.toggle('disabled', state.style === 'spacefill');
  document.getElementById('rowGap').classList.toggle('disabled', state.style !== 'ballstick');
  document.getElementById('hRow').style.display = state.style === 'sticks' ? 'none' : 'flex';
  rebuild();
}));

// ---------- UI：滑块 ----------
function bindSlider(id, vid, fmt, apply) {
  const el = document.getElementById(id), lbl = document.getElementById(vid);
  el.addEventListener('input', () => {
    apply(+el.value);
    lbl.textContent = fmt(+el.value);
    rebuild();
  });
}
bindSlider('sSphere', 'vSphere', v => v.toFixed(2), v => { state.sphereScale = v; });
bindSlider('sStick', 'vStick', v => v.toFixed(1), v => { state.stickScale = v; });
bindSlider('sGap', 'vGap', v => v.toFixed(2) + ' Å', v => { state.gap = v; });

// ---------- UI：图例 / 氢开关 ----------
const counts = {};
data.atoms.forEach(a => { counts[a.el] = (counts[a.el] || 0) + 1; });
const legend = document.getElementById('legend');
for (const [el, n] of Object.entries(counts)) {
  const li = document.createElement('li');
  li.innerHTML = `<span class="dot" style="background:${CPK_CSS[el]}"></span>
    ${EL_ZH[el]} ${el}<span class="count">${n}</span>`;
  legend.appendChild(li);
}
document.getElementById('hCount').textContent = counts.H || 0;
document.getElementById('toggleH').addEventListener('change', e => {
  state.showH = e.target.checked;
  rebuild();
});

const STYLE_DESC = {
  spacefill: '空间填充：球体半径 = 范德华半径，显示实际占据体积',
  ballstick: '球棍模型：原子球 + 化学键，经典结构展示',
  sticks: '棍状模型：仅显示化学键骨架',
};
function refreshStats() {
  document.getElementById('stats').textContent =
    `共 ${data.atoms.length} 个原子 · ${data.bonds.length} 根键 · ${STYLE_DESC[state.style]}`;
}
tabs.forEach(t => t.addEventListener('click', refreshStats));
refreshStats();

// ---------- 选择与批量改色 ----------
const selInfo = document.getElementById('selInfo');
const pickerRow = document.getElementById('pickerRow');
const colorPicker = document.getElementById('colorPicker');

function selectedMeshes() {
  const out = [];
  for (const key of state.selection) {
    if (key[0] === 'a') {
      const m = atomMeshes[+key.slice(1)];
      if (m.visible) out.push(m);
    } else {
      const cyl = bondGroup.children.find(c => c.userData.key === key && !c.userData.isProxy);
      if (cyl) out.push(cyl);
    }
  }
  return out;
}

function refreshSelInfo() {
  const n = state.selection.size;
  if (n === 0) {
    selInfo.textContent = '点击球体或棍子进行选择（可点选多个）';
    pickerRow.style.display = 'none';
    return;
  }
  let na = 0, nb = 0;
  for (const key of state.selection) key[0] === 'a' ? na++ : nb++;
  const parts = [];
  if (na) parts.push(`${na} 个原子`);
  if (nb) parts.push(`${nb} 根键`);
  selInfo.innerHTML = `已选中 <b>${n}</b> 项（${parts.join(' + ')}）`;
  pickerRow.style.display = 'flex';
}

colorPicker.addEventListener('input', e => {
  for (const m of selectedMeshes()) m.material.color.set(e.target.value);
});
document.getElementById('resetSel').addEventListener('click', () => {
  for (const m of selectedMeshes()) m.material.color.set(m.userData.base);
});
document.getElementById('resetAll').addEventListener('click', () => {
  for (const m of atomMeshes) m.material.color.set(m.userData.base);
  for (const c of bondGroup.children) {
    if (!c.userData.isProxy) c.material.color.set(BOND_BASE);
  }
});

// ---------- 拾取（点击切换选择，点空白清空） ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downPos = null;

function pickables() {
  const list = atomMeshes.filter(m => m.visible);
  for (const c of bondGroup.children) {
    if (c.userData.isProxy && state.style !== 'spacefill') list.push(c);
  }
  return list;
}

canvas.addEventListener('pointerdown', e => { downPos = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
  downPos = null;
  if (moved > 5) return;
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(pickables(), false);
  if (hits.length) {
    const k = hits[0].object.userData.key;
    state.selection.has(k) ? state.selection.delete(k) : state.selection.add(k);
  } else {
    state.selection.clear();
  }
  refreshHighlight();
  refreshSelInfo();
});

canvas.addEventListener('pointermove', e => {
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  canvas.style.cursor = ray.intersectObjects(pickables(), false).length ? 'pointer' : 'grab';
});

// ---------- resize / loop ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
rebuild();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
