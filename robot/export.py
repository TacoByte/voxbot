import json
import struct
from pathlib import Path

import mujoco
import numpy as np


ROOT = Path(__file__).resolve().parent
MODEL = ROOT / "vendor" / "unitree_rl_mjlab" / "src" / "assets" / "robots" / "unitree_g1" / "xmls" / "scene_g1.xml"
OUTPUT = ROOT.parent / "dist" / "models" / "g1.glb"
BASIS = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float32)


def align(data):
    while len(data) % 4:
        data.append(0)


def export():
    model = mujoco.MjModel.from_xml_path(str(MODEL))
    binary = bytearray()
    views = []
    accessors = []
    meshes = []
    materials = []
    nodes = [{"name": f"g1:{model.body(i).name}", "children": []} for i in range(1, model.nbody)]
    material_ids = {}

    def accessor(values, component, kind, target, bounds=False):
        align(binary)
        offset = len(binary)
        binary.extend(values.tobytes())
        view = len(views)
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": values.nbytes, "target": target})
        item = {"bufferView": view, "componentType": component, "count": len(values), "type": kind}
        if bounds:
            item["min"] = values.min(axis=0).tolist()
            item["max"] = values.max(axis=0).tolist()
        accessors.append(item)
        return len(accessors) - 1

    for geom in range(1, model.ngeom):
        if model.geom_type[geom] != mujoco.mjtGeom.mjGEOM_MESH or model.geom_contype[geom]:
            continue
        mesh = int(model.geom_dataid[geom])
        vert_at = int(model.mesh_vertadr[mesh])
        vert_count = int(model.mesh_vertnum[mesh])
        face_at = int(model.mesh_faceadr[mesh])
        face_count = int(model.mesh_facenum[mesh])
        vertices = model.mesh_vert[vert_at : vert_at + vert_count].astype(np.float32)
        faces = model.mesh_face[face_at : face_at + face_count].astype(np.uint32)
        rotation = np.empty(9)
        mujoco.mju_quat2Mat(rotation, model.geom_quat[geom])
        vertices = (((vertices @ rotation.reshape(3, 3).T) + model.geom_pos[geom]) @ BASIS).astype(np.float32)
        normals = np.zeros_like(vertices)
        face_normals = np.cross(vertices[faces[:, 1]] - vertices[faces[:, 0]], vertices[faces[:, 2]] - vertices[faces[:, 0]])
        for corner in range(3):
            np.add.at(normals, faces[:, corner], face_normals)
        lengths = np.linalg.norm(normals, axis=1)
        normals /= np.maximum(lengths[:, None], 1e-8)
        rgba = tuple(float(value) for value in model.geom_rgba[geom])
        material = material_ids.get(rgba)
        if material is None:
            material = len(materials)
            material_ids[rgba] = material
            materials.append({"pbrMetallicRoughness": {"baseColorFactor": list(rgba), "metallicFactor": 0.65, "roughnessFactor": 0.32}})
        mesh_id = len(meshes)
        meshes.append(
            {
                "name": model.mesh(mesh).name,
                "primitives": [
                    {
                        "attributes": {
                            "POSITION": accessor(vertices, 5126, "VEC3", 34962, True),
                            "NORMAL": accessor(normals, 5126, "VEC3", 34962),
                        },
                        "indices": accessor(faces.reshape(-1), 5125, "SCALAR", 34963),
                        "material": material,
                    }
                ],
            }
        )
        node_id = len(nodes)
        nodes.append({"name": f"g1-mesh:{model.mesh(mesh).name}", "mesh": mesh_id})
        nodes[int(model.geom_bodyid[geom]) - 1]["children"].append(node_id)

    align(binary)
    gltf = {
        "asset": {"version": "2.0", "generator": "voxbot"},
        "scene": 0,
        "scenes": [{"nodes": list(range(model.nbody - 1))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(binary)}],
    }
    encoded = json.dumps(gltf, separators=(",", ":")).encode()
    encoded += b" " * ((4 - len(encoded) % 4) % 4)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(
        struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(encoded) + 8 + len(binary))
        + struct.pack("<I4s", len(encoded), b"JSON")
        + encoded
        + struct.pack("<I4s", len(binary), b"BIN\0")
        + binary
    )
    print(OUTPUT)


if __name__ == "__main__":
    export()
