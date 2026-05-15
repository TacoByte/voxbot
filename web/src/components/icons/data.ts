// Icon definitions as heredocs - much easier to edit visually
// # = filled pixel, . = empty

const RAW_ICONS = {
  account: `
    ...#....
    ..#.#...
    ..#.#...
    ...#....
    ..#.#...
    .#...#..
    .#.#.#..
    .#.#.#..
  `,

  costume: `
    ..####..
    .######.
    ##....##
    ##....##
    .##..##.
    .##..##.
    ..####..
    ........
  `,

  assets: `
    .##..##.
    ########
    ##..##..
    ########
    .##..##.
    .##..##.
    ........
    ........
  `,

  collections: `
    ###.....
    #.#.###.
    ###.###.
    ....###.
    .###....
    .#.#....
    .###....
    ........
  `,

  events: `
    #######.
    #.....#.
    #..#..#.
    #..#..#.
    #.....#.
    #######.
    #.....#.
    #######.
  `,

  islands: `
    ..###...
    .#####..
    #######.
    ##...##.
    ##...##.
    .#####..
    ..###...
    ........
  `,

  map: `
    ..###...
    .#####..
    ##.#.##.
    ########
    .##.##..
    .#...#..
    ........
    ........
  `,

  parcels: `
    #######.
    #.....#.
    #.###.#.
    #.#.#.#.
    #.###.#.
    #.....#.
    #######.
    ........
  `,

  spaces: `
    #######.
    #.#.#.#.
    #######.
    #.#.#.#.
    #######.
    #.#.#.#.
    #######.
    ........
  `,

  womps: `
    ..###...
    .#####..
    ##.#.##.
    ########
    .##.##..
    .#...#..
    ........
    ........
  `,

  scratchpad: `
    #######.
    #.....#.
    #.###.#.
    #.#.#.#.
    #.###.#.
    #.....#.
    #######.
    ........
  `,

  logout: `
    ##..###.
    #.#.#...
    ##..##..
    #.#.#...
    ##..###.
    ...#....
    ...##...
    ........
  `,

  v: `
    ........
    .#...#..
    .#...#..
    .#...#..
    ..#.#...
    ...#....
    ........
    ........
  `,
}

// Parser: convert heredoc strings to Uint8Array (64 bytes for 8x8)
function parseIcon(heredocString: string) {
  const arr = new Uint8Array(64)
  let idx = 0

  heredocString
    .trim()
    .split('\n')
    .forEach((line: string) => {
      const trimmed = line.trim()
      if (trimmed.length === 8) {
        for (let i = 0; i < 8; i++) {
          arr[idx++] = trimmed[i] === '#' ? 1 : 0
        }
      }
    })

  return arr
}

// Build the final icons object
const ICON_DATA: Record<string, { name: string; bitmap: Uint8Array }> = {}

Object.entries(RAW_ICONS).forEach(([key, heredoc]) => {
  ICON_DATA[key] = {
    name: key.charAt(0).toUpperCase() + key.slice(1),
    bitmap: parseIcon(heredoc),
  }
})

// Export for use
export { ICON_DATA, parseIcon }
