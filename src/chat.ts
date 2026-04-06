export const getTextLines = (ctx: CanvasRenderingContext2D, text: string, width: number): string[] => {
  const lines = []
  const words = text.split(' ')
  let currentLine = ''
  for (const word of words) {
    if (ctx.measureText(currentLine + ' ' + word).width > width) {
      lines.push(currentLine)
      currentLine = word
    }
  }

  if (currentLine) {
    lines.push(currentLine)
  }

  return lines
}

export const getLineMaxWidth = (ctx: CanvasRenderingContext2D, lines: string[]): number => {
  return lines.reduce((result, line) => {
    return Math.max(result, ctx.measureText(line).width)
  }, 0)
}

const WIDTH = 512
const HEIGHT = 256
export class Bubble extends BABYLON.Mesh {
  private texture: BABYLON.DynamicTexture
  constructor(
    scene: BABYLON.Scene,
    parent: BABYLON.TransformNode,
    public readonly text: string,
  ) {
    super('chat', scene)

    // 1. Get the geometry data for a plane
    // We create a temporary mesh just to steal its vertex data
    const vertexData = BABYLON.VertexData.CreatePlane({
      width: 2,
      height: 1,
      sideOrientation: BABYLON.Mesh.DOUBLESIDE, // Easier to see while debugging
    })

    // 2. Apply that geometry to 'this' instance
    vertexData.applyToMesh(this)

    this.texture = new BABYLON.DynamicTexture(
      'chat',
      {
        width: WIDTH,
        height: HEIGHT,
      },
      scene,
    )
    this.texture.hasAlpha = true

    const m = new BABYLON.StandardMaterial('chat', scene)
    m.diffuseTexture = this.texture
    m.sideOrientation = BABYLON.Mesh.DOUBLESIDE
    m.useAlphaFromDiffuseTexture = true
    this.material = m

    this.parent = parent
    this.drawText()
  }

  getContext() {
    return this.texture.getContext() as CanvasRenderingContext2D
  }

  private drawText() {
    const ctx = this.getContext() as CanvasRenderingContext2D
    const WIDTH = 512
    const HEIGHT = 256

    ctx.clearRect(0, 0, WIDTH, HEIGHT)

    // 1. Comic-style font (Make sure it's loaded in your CSS)
    ctx.font = "bold 32px 'Bangers', 'Comic Sans MS', sans-serif"
    ctx.textBaseline = 'top'

    const lines = getTextLines(ctx, this.text, WIDTH - 100)
    const lineHeight = 36

    const w = getLineMaxWidth(ctx, lines) + 60 // Extra padding for bubble
    const h = lineHeight * lines.length + 40

    const left = (WIDTH - w) / 2
    const top = 40

    // 2. Draw the Speech Bubble Shape
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 5
    ctx.strokeStyle = '#000000'
    ctx.fillStyle = '#ffffff'

    ctx.beginPath()
    // Rounded bubble body
    ctx.roundRect(left, top, w, h, 30)

    // 3. The "Tail" (Pointing down)
    ctx.moveTo(WIDTH / 2 - 20, top + h - 2)
    ctx.lineTo(WIDTH / 2 - 40, top + h + 40) // Tip of tail
    ctx.lineTo(WIDTH / 2 + 5, top + h - 2)

    ctx.fill()
    ctx.stroke()

    // 4. Draw the Text (All caps for that comic feel)
    ctx.fillStyle = '#000000'
    lines.forEach((line, index) => {
      const textWidth = ctx.measureText(line.toUpperCase()).width
      const xOffset = left + (w - textWidth) / 2 // Center text in bubble
      ctx.fillText(line.toUpperCase(), xOffset, top + 20 + index * lineHeight)
    })

    this.texture.update()
  }
}
