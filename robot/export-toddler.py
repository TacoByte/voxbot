from pathlib import Path

import mujoco
import numpy as np

from export_utils import BASIS, write_glb


ROOT = Path(__file__).resolve().parent
MODEL = ROOT / "vendor" / "toddlerbot" / "toddlerbot" / "descriptions" / "toddlerbot_2xc" / "scene.xml"
OUTPUT = ROOT.parent / "dist" / "models" / "toddler.glb"


def export():
    model = mujoco.MjModel.from_xml_path(str(MODEL))
    nodes = [{"name": f"toddler:{model.body(i).name}", "children": []} for i in range(1, model.nbody)]
    items = []
    for geom in range(1, model.ngeom):
        if model.geom_type[geom] != mujoco.mjtGeom.mjGEOM_MESH or model.geom_contype[geom]:
            continue
        mesh = int(model.geom_dataid[geom])
        vert_at = int(model.mesh_vertadr[mesh])
        face_at = int(model.mesh_faceadr[mesh])
        vertices = model.mesh_vert[vert_at : vert_at + int(model.mesh_vertnum[mesh])].astype(np.float32)
        faces = model.mesh_face[face_at : face_at + int(model.mesh_facenum[mesh])].astype(np.uint32)
        rotation = np.empty(9)
        mujoco.mju_quat2Mat(rotation, model.geom_quat[geom])
        vertices = (((vertices @ rotation.reshape(3, 3).T) + model.geom_pos[geom]) @ BASIS).astype(np.float32)
        name = model.mesh(mesh).name
        material = int(model.geom_matid[geom])
        rgba = model.mat_rgba[material] if material >= 0 else model.geom_rgba[geom]
        items.append((int(model.geom_bodyid[geom]) - 1, f"toddler-mesh:{name}", name, vertices, faces, tuple(float(value) for value in rgba), 0.1, 0.7))
    write_glb(OUTPUT, nodes, items)


if __name__ == "__main__":
    export()
