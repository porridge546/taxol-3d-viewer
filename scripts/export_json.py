# -*- coding: utf-8 -*-
"""Export paclitaxel 3D conformer (MMFF-optimized, seed=42, deterministic)
to public/taxol.json for the web viewer."""
import json
from rdkit import Chem
from rdkit.Chem import AllChem

SMILES = ("CC1=C2[C@H](C(=O)[C@@]3([C@H](C[C@@H]4[C@]([C@H]3[C@@H]([C@@]"
          "(C2(C)C)(C[C@@H]1OC(=O)[C@@H]([C@H](C5=CC=CC=C5)NC(=O)C6=CC=CC"
          "=C6)O)O)OC(=O)C7=CC=CC=C7)(CO4)OC(=O)C)O)C)OC(=O)C")

VDW = {"H": 1.20, "C": 1.70, "N": 1.55, "O": 1.52}

m = Chem.MolFromSmiles(SMILES)
m = Chem.AddHs(m)
AllChem.EmbedMolecule(m, randomSeed=42)
AllChem.MMFFOptimizeMolecule(m, maxIters=2000)
conf = m.GetConformer()

atoms = []
for i, a in enumerate(m.GetAtoms()):
    p = conf.GetAtomPosition(i)
    atoms.append({
        "i": i,
        "el": a.GetSymbol(),
        "x": round(p.x, 3), "y": round(p.y, 3), "z": round(p.z, 3),
        "r": VDW.get(a.GetSymbol(), 1.5),
    })

bonds = []
for b in m.GetBonds():
    bonds.append({
        "a": b.GetBeginAtomIdx(),
        "b": b.GetEndAtomIdx(),
        "o": int(b.GetBondTypeAsDouble()),
    })

data = {
    "name": "紫杉醇 Paclitaxel (Taxol)",
    "formula": "C47H51NO14",
    "atoms": atoms,
    "bonds": bonds,
}
with open("public/taxol.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False)
print("atoms:", len(atoms), "bonds:", len(bonds))
