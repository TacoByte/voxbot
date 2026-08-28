import json
import struct
from pathlib import Path

import mujoco
import numpy as np


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "assets" / "macroduck" / "source.glb"
KINEMATICS = ROOT / "assets" / "macroduck" / "kinematics.json"
OUTPUT = ROOT.parent / "dist" / "models" / "macroduck.glb"
BASIS = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float32)


def align(data):
    while len(data) % 4:
        data.append(0)


def export():
    source = SOURCE.read_bytes()
    json_size, json_type = struct.unpack_from("<I4s", source, 12)
    if json_type != b"JSON":
        raise ValueError("Invalid source GLB")
    source_gltf = json.loads(source[20 : 20 + json_size])
    bin_at = 20 + json_size
    bin_size, bin_type = struct.unpack_from("<I4s", source, bin_at)
    if bin_type != b"BIN\0":
        raise ValueError("Invalid source GLB")
    source_binary = source[bin_at + 8 : bin_at + 8 + bin_size]
    kinematics = json.loads(KINEMATICS.read_text())
    source_meshes = {mesh["name"]: mesh for mesh in source_gltf["meshes"]}
    binary = bytearray()
    views = []
    accessors = []
    meshes = []
    materials = []
    nodes = [{"name": f"macroduck:{body['name']}", "children": []} for body in kinematics["bodies"]]
    material_ids = {}

    def source_accessor(index):
        item = source_gltf["accessors"][index]
        view = source_gltf["bufferViews"][item["bufferView"]]
        offset = view.get("byteOffset", 0) + item.get("byteOffset", 0)
        components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[item["type"]]
        dtype = {5123: np.uint16, 5125: np.uint32, 5126: np.float32}[item["componentType"]]
        values = np.frombuffer(source_binary, dtype=dtype, count=item["count"] * components, offset=offset)
        return values.reshape(item["count"], components) if components > 1 else values

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

    seen = set()
    for body_id, body in enumerate(kinematics["bodies"]):
        for geom in body["geoms"]:
            name = geom.get("mesh")
            key = (body["name"], name, tuple(geom.get("pos", [])), tuple(geom.get("quat", [])))
            if geom.get("type", "mesh") != "mesh" or not name or key in seen:
                continue
            seen.add(key)
            primitive = source_meshes[name]["primitives"][0]
            vertices = source_accessor(primitive["attributes"]["POSITION"]).astype(np.float32)
            faces = source_accessor(primitive["indices"]).astype(np.uint32).reshape(-1, 3)
            quat = geom.get("quat", [1, 0, 0, 0])
            rotation = np.empty(9)
            mujoco.mju_quat2Mat(rotation, [quat[0], quat[1], quat[2], quat[3]])
            vertices = (((vertices @ rotation.reshape(3, 3).T) + geom.get("pos", [0, 0, 0])) @ BASIS).astype(np.float32)
            normals = np.zeros_like(vertices)
            face_normals = np.cross(vertices[faces[:, 1]] - vertices[faces[:, 0]], vertices[faces[:, 2]] - vertices[faces[:, 0]])
            for corner in range(3):
                np.add.at(normals, faces[:, corner], face_normals)
            normals /= np.maximum(np.linalg.norm(normals, axis=1)[:, None], 1e-8)
            rgba = tuple(float(value) for value in geom.get("color", [0.85, 0.85, 0.85, 1]))
            material = material_ids.get(rgba)
            if material is None:
                material = len(materials)
                material_ids[rgba] = material
                materials.append({"pbrMetallicRoughness": {"baseColorFactor": list(rgba), "metallicFactor": 0.15, "roughnessFactor": 0.55}})
            mesh_id = len(meshes)
            meshes.append(
                {
                    "name": name,
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
            nodes.append({"name": f"macroduck-mesh:{body['name']}:{name}", "mesh": mesh_id})
            nodes[body_id]["children"].append(node_id)

    align(binary)
    gltf = {
        "asset": {"version": "2.0", "generator": "voxbot"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(kinematics["bodies"]))) }],
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
