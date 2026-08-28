export const mergeBoxes = (filled: Set<string>): number[] => {
  const boxes: number[] = []
  while (filled.size) {
    const key = filled.values().next().value as string
    const [x, y, z] = key.split(',').map(Number)
    let dx = 1
    let dy = 1
    let dz = 1
    while (filled.has(`${x + dx},${y},${z}`)) dx++
    while (true) {
      let full = true
      for (let ix = 0; ix < dx; ix++) if (!filled.has(`${x + ix},${y},${z + dz}`)) full = false
      if (!full) break
      dz++
    }
    while (true) {
      let full = true
      for (let ix = 0; ix < dx; ix++) for (let iz = 0; iz < dz; iz++) if (!filled.has(`${x + ix},${y + dy},${z + iz}`)) full = false
      if (!full) break
      dy++
    }
    for (let ix = 0; ix < dx; ix++) for (let iy = 0; iy < dy; iy++) for (let iz = 0; iz < dz; iz++) filled.delete(`${x + ix},${y + iy},${z + iz}`)
    boxes.push(x, y, z, dx, dy, dz)
  }
  return boxes
}
