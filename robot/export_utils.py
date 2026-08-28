import json
import struct

import numpy as np


BASIS = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float32)


def align(data):
    while len(data) % 4:
        data.append(0)


def write_glb(output, nodes, items):
    binary = bytearray()
    views = []
    accessors = []
    meshes = []
    materials = []
    material_ids = {}
    root_count = len(nodes)

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

    for body, node_name, mesh_name, vertices, faces, rgba, metallic, roughness in items:
        normals = np.zeros_like(vertices)
        face_normals = np.cross(vertices[faces[:, 1]] - vertices[faces[:, 0]], vertices[faces[:, 2]] - vertices[faces[:, 0]])
        for corner in range(3):
            np.add.at(normals, faces[:, corner], face_normals)
        normals /= np.maximum(np.linalg.norm(normals, axis=1)[:, None], 1e-8)
        material_key = (rgba, metallic, roughness)
        material = material_ids.get(material_key)
        if material is None:
            material = len(materials)
            material_ids[material_key] = material
            materials.append({"pbrMetallicRoughness": {"baseColorFactor": list(rgba), "metallicFactor": metallic, "roughnessFactor": roughness}})
        mesh_id = len(meshes)
        meshes.append(
            {
                "name": mesh_name,
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
        nodes.append({"name": node_name, "mesh": mesh_id})
        nodes[body]["children"].append(node_id)

    align(binary)
    gltf = {
        "asset": {"version": "2.0", "generator": "voxbot"},
        "scene": 0,
        "scenes": [{"nodes": list(range(root_count))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(binary)}],
    }
    encoded = json.dumps(gltf, separators=(",", ":")).encode()
    encoded += b" " * ((4 - len(encoded) % 4) % 4)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(
        struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(encoded) + 8 + len(binary))
        + struct.pack("<I4s", len(encoded), b"JSON")
        + encoded
        + struct.pack("<I4s", len(binary), b"BIN\0")
        + binary
    )
    print(output)
