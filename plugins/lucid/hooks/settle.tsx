import type { ClientModule } from 'claude-code'

export type SettleProps = { flash: string; flashColor: string; glyph: string; color: string; ms: number }

const Settle: ClientModule<SettleProps, true> = (props, surface) => {
  const { Text } = surface.elements
  if (surface.state === undefined) {
    const stop = surface.every(Math.max(16, props.ms), () => {
      stop()
      surface.setState(true)
    })
  }
  return surface.state ? <Text color={props.color}>{props.glyph}</Text> : <Text bold color={props.flashColor}>{props.flash}</Text>
}

export default Settle
