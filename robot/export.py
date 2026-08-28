import json
import struct
from pathlib import Path

import mujoco
import numpy as np

from export_utils import BASIS, write_glb


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "assets" / "macroduck" / "source.glb"
KINEMATICS = ROOT / "assets" / "macroduck" / "kinematics.json"
OUTPUT = ROOT.parent / "dist" / "models" / "macroduck.glb"


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
    nodes = [{"name": f"macroduck:{body['name']}", "children": []} for body in kinematics["bodies"]]

    def source_accessor(index):
        item = source_gltf["accessors"][index]
        view = source_gltf["bufferViews"][item["bufferView"]]
        offset = view.get("byteOffset", 0) + item.get("byteOffset", 0)
        components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[item["type"]]
        dtype = {5123: np.uint16, 5125: np.uint32, 5126: np.float32}[item["componentType"]]
        values = np.frombuffer(source_binary, dtype=dtype, count=item["count"] * components, offset=offset)
        return values.reshape(item["count"], components) if components > 1 else values

    items = []
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
            mujoco.mju_quat2Mat(rotation, quat)
            vertices = (((vertices @ rotation.reshape(3, 3).T) + geom.get("pos", [0, 0, 0])) @ BASIS).astype(np.float32)
            node_name = f"macroduck-mesh:{body['name']}:{name}"
            rgba = tuple(float(value) for value in geom.get("color", [0.85, 0.85, 0.85, 1]))
            items.append((body_id, node_name, name, vertices, faces, rgba, 0.15, 0.55))
    write_glb(OUTPUT, nodes, items)


if __name__ == "__main__":
    export()
