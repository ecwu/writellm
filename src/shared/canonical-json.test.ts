import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from './canonical-json'

const fixtures = [
  {
    name: 'nested',
    input: { z: 3, a: { beta: false, alpha: 'é\n汉字' }, items: [true, null, { b: 2, a: 1 }] },
    serialized: '{"a":{"alpha":"é\\n汉字","beta":false},"items":[true,null,{"a":1,"b":2}],"z":3}',
    sha256: 'fdc04749604f3ab8e4c052b2245ffb57a362e4cbe311d973bc0e1f1bd809f898'
  },
  {
    name: 'undefined-members',
    input: { z: undefined, a: [undefined, null, 1], nested: { absent: undefined, present: true } },
    serialized: '{"a":[,null,1],"nested":{"absent":undefined,"present":true},"z":undefined}',
    sha256: '2ee7ccc303839d3b9a3f01aed908ad4a2e5d8b55eb162506102a9363644e1ea8'
  },
  {
    name: 'sparse-array',
    input: Object.assign(new Array<unknown>(3), { 1: undefined, 2: { x: undefined } }),
    serialized: '[,,{"x":undefined}]',
    sha256: '1d703faf7e11206eae65623d476d4f77f714ee199852489c6016c0e5b4e161ba'
  },
  {
    name: 'non-finite',
    input: { z: -Infinity, a: NaN, n: -0 },
    serialized: '{"a":null,"n":0,"z":null}',
    sha256: '2885065523b75e2ba778bdf3c6447b5707e4a01973bfffc510fffa00a1c57216'
  },
  {
    name: 'escaped-keys',
    input: { 'quote"': '\\', α: '汉字', a: null },
    serialized: '{"a":null,"quote\\"":"\\\\","α":"汉字"}',
    sha256: 'b8e75d3caf3dbc6ef1bdf70b6a3c36427b92290683d7e1020edfa95d44e243de'
  }
]

describe('legacy canonical JSON compatibility', () => {
  it.each(fixtures)(
    'retains the fixed output and hash for $name',
    ({ input, serialized, sha256 }) => {
      expect(canonicalJson(input)).toBe(serialized)
      expect(createHash('sha256').update(canonicalJson(input)).digest('hex')).toBe(sha256)
    }
  )
  it('retains an undefined root without changing it to a JSON null', () => {
    expect(canonicalJson(undefined)).toBeUndefined()
  })
})
