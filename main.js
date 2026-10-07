import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';

const CPK = { H: 0xf2f2f2, C: 0x8c8c8c, N: 0x3050f8, O: 0xff2a2a };
const CPK_CSS = { H: '#f2f2f2', C: '#8c8c8c', N: '#3050f8', O: '#ff2a2a' };
const EL_ZH = { H: '氢', C: '碳', N: '氮', O: '氧' };
const BOND_BASE = 0x9a9a9a;          // 棍子默认灰
const BALL_R = { H: 0.27, C: 0.64, N: 0.59, O: 0.55 };
// 球棍模式原子球基准半径（Å）：按共价半径比例 H:C:N:O ≈ 31:76:71:66，
// 碳最大、氢最小，不同元素有明显大小差异
const STICK_R = 0.16;                // 棍子基准半径（Å）

// ---------- state ----------
const state = {
  style: 'ballstick',                // spacefill | ballstick | sticks（默认球棍）
  sphereScale: 1, stickScale: 1, gap: 0.15, gapH: 0,
  hiddenEls: new Set(),            // 被隐藏的元素种类，如 {'H','C'}
  bend: new Map(),                 // 'b<idx>' -> 弧度，选中键的键角弯折量
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
  const base = state.style === 'spacefill' ? mesh.userData.vdw : BALL_R[mesh.userData.el];
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
    if (state.hiddenEls.has(ma.userData.el) || state.hiddenEls.has(mb.userData.el)) return;
    if (state.style === 'spacefill') return;   // 空间填充不画键

    const p1 = curPos[bd.a], p2 = curPos[bd.b];
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();
    dir.normalize();

    // 球棍模式：棍子两端插入原子球内部（深度为各自半径的 55%），
    // 球面与棍子交界处没有缝隙；棍状模式下不收口、贯穿到原子中心
    const cap = state.style === 'ballstick' ? 1 : 0;
    const trimA = Math.min(atomRadius(ma) * 0.55, len * 0.45) * cap;
    const trimB = Math.min(atomRadius(mb) * 0.55, len * 0.45) * cap;
    const segLen = Math.max(len - trimA - trimB, 0.05);
    const start = new THREE.Vector3().copy(p1).addScaledVector(dir, trimA);

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

// 邻接表与子树（键角弯折用）
const adj = atomPos.map(() => []);
data.bonds.forEach((bd, k) => {
  adj[bd.a].push([bd.b, k]);
  adj[bd.b].push([bd.a, k]);
});
// 从 root 出发、不跨越键 skipK 能到达的所有原子（含 root）
function subtree(root, skipK) {
  const seen = new Set([root]);
  const stack = [root];
  while (stack.length) {
    const u = stack.pop();
    for (const [v, k] of adj[u]) {
      if (k === skipK || seen.has(v)) continue;
      seen.add(v);
      stack.push(v);
    }
  }
  return seen;
}

// 把弯折量应用到基础坐标：绕枢轴原子旋转较小一侧的子树，
// 转轴 = 屏幕垂直方向（在模型本地坐标系中），掰动选中的键
function applyBends(base) {
  if (!state.bend.size) return base;
  const pos = base.map(p => p.clone());
  const q = new THREE.Quaternion();
  modelGroup.getWorldQuaternion(q);
  const axis = new THREE.Vector3();
  camera.getWorldDirection(axis);
  axis.applyQuaternion(q.invert()).normalize();
  for (const [key, theta] of state.bend) {
    if (!theta) continue;
    const bd = data.bonds[+key.slice(1)];
    const sideA = subtree(bd.a, +key.slice(1));
    // 旋转较小一侧，避免大范围结构跟着动
    const root = sideA.size <= data.atoms.length - sideA.size ? bd.a : bd.b;
    const pivot = root === bd.a ? bd.b : bd.a;
    for (const i of subtree(root, +key.slice(1))) {
      pos[i].sub(pos[pivot]).applyAxisAngle(axis, theta).add(pos[pivot]);
    }
  }
  return pos;
}

function rebuild() {
  // 先应用键角弯折，再在弯折后的坐标上拉开间距
  const basePos = applyBends(atomPos);
  // 间距：球棍模式下原子沿化学键方向拉开。
  // 普通键每端拉开 state.gap；含氢的键额外每端拉开 state.gapH（可单独调整，可为负=调短）
  const base = state.style === 'ballstick' ? state.gap : 0;
  const extraH = state.style === 'ballstick' ? state.gapH : 0;
  const disp = atomPos.map(() => new THREE.Vector3());
  for (const bd of data.bonds) {
    const isHBond = atomMeshes[bd.a].userData.el === 'H'
                 || atomMeshes[bd.b].userData.el === 'H';
    const g = base + (isHBond ? extraH : 0);
    if (g === 0) continue;
    const dir = new THREE.Vector3().subVectors(basePos[bd.b], basePos[bd.a]);
    if (dir.lengthSq() < 1e-12) continue;
    dir.normalize();
    disp[bd.a].addScaledVector(dir, -g);
    disp[bd.b].addScaledVector(dir, g);
  }
  const curPos = basePos.map((p, i) => p.clone().add(disp[i]));

  // 原子球：位置 / 半径 / 可见性
  atomMeshes.forEach((m, i) => {
    m.visible = state.style !== 'sticks' && !state.hiddenEls.has(m.userData.el);
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
  document.getElementById('rowGapH').classList.toggle('disabled', state.style !== 'ballstick');
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
bindSlider('sGapH', 'vGapH', v => v.toFixed(2) + ' Å', v => { state.gapH = v; });

// 模型整体朝向（对应参考图的摆放角度）：只旋转、不改结构，无需 rebuild
function bindRotation(id, vid, fmt, apply) {
  const el = document.getElementById(id), lbl = document.getElementById(vid);
  el.addEventListener('input', () => {
    apply(+el.value);
    lbl.textContent = fmt(+el.value);
  });
}
bindRotation('sRotY', 'vRotY', v => v.toFixed(0) + '°',
  v => { modelGroup.rotation.y = THREE.MathUtils.degToRad(v); });
bindRotation('sRotX', 'vRotX', v => v.toFixed(0) + '°',
  v => { modelGroup.rotation.x = THREE.MathUtils.degToRad(v); });

// 一键恢复打开页面时的初始状态（含视角、键角、间距、显隐、颜色、选择）
document.getElementById('resetView').addEventListener('click', () => {
  state.sphereScale = 1; state.stickScale = 1;
  state.gap = 0.15; state.gapH = 0;
  state.bend.clear();
  state.selection.clear();
  state.hiddenEls.clear();
  const set = (id, v) => {
    const el = document.getElementById(id);
    el.value = v;
    el.dispatchEvent(new Event('input'));
  };
  set('sSphere', 1); set('sStick', 1);
  set('sGap', 0.15); set('sGapH', 0);
  set('sRotY', 170); set('sRotX', 10);
  refreshLegendStyles();
  for (const m of atomMeshes) m.material.color.set(m.userData.base);
  for (const c of bondGroup.children) {
    if (!c.userData.isProxy) c.material.color.set(BOND_BASE);
  }
  rebuild();
});

// ---------- UI：图例 / 按元素显隐 ----------
// 图例每一项就是一个开关：点击可隐藏/显示该元素的原子球，
// 涉及该元素的化学键会同步隐藏（棍状模式下同样生效）
const counts = {};
data.atoms.forEach(a => { counts[a.el] = (counts[a.el] || 0) + 1; });
const legend = document.getElementById('legend');
for (const [el, n] of Object.entries(counts)) {
  const li = document.createElement('li');
  li.className = 'el-toggle';
  li.dataset.el = el;
  li.title = '点击隐藏 / 再次点击显示';
  li.innerHTML = `<span class="dot" style="background:${CPK_CSS[el]}"></span>
    ${EL_ZH[el]} ${el}<span class="count">${n}</span>`;
  li.addEventListener('click', () => {
    state.hiddenEls.has(el) ? state.hiddenEls.delete(el) : state.hiddenEls.add(el);
    refreshLegendStyles();
    rebuild();
  });
  legend.appendChild(li);
}
function refreshLegendStyles() {
  legend.querySelectorAll('li').forEach(li => {
    li.classList.toggle('off', state.hiddenEls.has(li.dataset.el));
  });
}
refreshLegendStyles();

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
  // 只选中一根键时，显示键角调节
  const bondKeys = [...state.selection].filter(k => k[0] === 'b');
  if (bondKeys.length === 1 && na === 0) {
    angleRow.style.display = 'block';
    const deg = (state.bend.get(bondKeys[0]) || 0) * 180 / Math.PI;
    sAngle.value = deg.toFixed(0);
    vAngle.textContent = deg.toFixed(0) + '°';
  } else {
    angleRow.style.display = 'none';
  }
}

// ---------- 键角调节（选中单根键时可用） ----------
const angleRow = document.getElementById('angleRow');
const sAngle = document.getElementById('sAngle');
const vAngle = document.getElementById('vAngle');
sAngle.addEventListener('input', () => {
  const bondKeys = [...state.selection].filter(k => k[0] === 'b');
  if (bondKeys.length !== 1) return;
  const deg = +sAngle.value;
  vAngle.textContent = deg.toFixed(0) + '°';
  state.bend.set(bondKeys[0], THREE.MathUtils.degToRad(deg));
  rebuild();
});

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
