import { describe, expect, it } from 'vitest'
import { validateSegmentLayout } from './validation.ts'

const seg = (imageIndex: number, segmentIndex: number, offsetY: number, fullHeight = 6000) => ({ imageIndex, segmentIndex, offsetY, fullHeight })
const size = (height = 3000, width = 1080) => ({ width, height })

describe('validateSegmentLayout', () => {
  it('acepta las franjas en orden de una o varias capturas', () => {
    const raw = [seg(0, 0, 0), seg(0, 1, 2800), seg(1, 0, 0, 2000)]
    const result = validateSegmentLayout(raw, [size(), size(3000), size(2000)])
    expect(result).toEqual({ ok: true, value: raw })
  })

  it('rechaza números que no son enteros o están fuera de rango', () => {
    expect(validateSegmentLayout([seg(0, 0, 0.5)], [size()]).ok).toBe(false)
    expect(validateSegmentLayout([seg(6, 0, 0)], [size()]).ok).toBe(false)
    expect(validateSegmentLayout([{ ...seg(0, 0, 0), fullHeight: 0 }], [size()]).ok).toBe(false)
    expect(validateSegmentLayout(['franja'], [size()]).ok).toBe(false)
  })

  it('rechaza franjas desordenadas, de otra imagen o que se salen de la altura', () => {
    const unordered = { ok: false, error: 'Las franjas deben estar ordenadas y pertenecer a la misma imagen.' }
    expect(validateSegmentLayout([seg(0, 1, 0)], [size()])).toEqual(unordered)
    expect(validateSegmentLayout([seg(0, 0, 0), seg(0, 1, 0)], [size(), size()])).toEqual(unordered)
    expect(validateSegmentLayout([seg(0, 0, 0), seg(0, 1, 2800)], [size(), size(3000, 900)])).toEqual(unordered)
    expect(validateSegmentLayout([seg(0, 0, 0, 2000)], [size(3000)])).toEqual(unordered)
    expect(validateSegmentLayout([seg(0, 0, 0, 9000)], [size(5000)])).toEqual(unordered)
  })
})
