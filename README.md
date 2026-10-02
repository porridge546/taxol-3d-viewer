# 紫杉醇 3D 分子模型交互器

紫杉醇（Paclitaxel / Taxol，C₄₇H₅₁NO₁₄）的交互式 3D 分子模型查看器，纯静态站点（Three.js 经 CDN 加载），部署于 GitHub Pages。

**在线查看**：https://porridge546.github.io/taxol-3d-viewer/

## 功能

- 三种模型切换：空间填充 / 球棍模型 / 棍状模型
- 鼠标拖动旋转、滚轮缩放、右键平移
- 点击球体或棍子进行选择（支持多选），取色器批量改色
- 球体大小、棍子粗细、球棍间距实时调节
- 氢原子显示开关

## 文件结构

- `index.html` — 页面（含 importmap，从 jsdelivr CDN 加载 three.js）
- `main.js` — Three.js 场景与交互逻辑
- `style.css` — 界面样式
- `taxol.json` — 分子 3D 构象数据（113 原子 / 119 键，RDKit MMFF 优化，固定随机种子）

## 数据来源

分子结构为 PubChem CID 36314 的立体化学 SMILES，与 PubChem 逐字符一致；3D 构象由 RDKit 嵌入并经 MMFF 力场优化（seed=42，确定性生成）。

## 本地运行

任意静态服务器即可，例如：

```bash
python -m http.server 7100
```

或 `npm run dev`（同样调用 python http.server）。
