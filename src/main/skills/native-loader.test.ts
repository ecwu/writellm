import { describe, expect, it } from 'vitest'
import { loadManifestSkillWithPi } from './native-loader'

describe('manifest-backed Pi Writing Skill loader', () => {
  it('loads one virtual entrypoint without exposing a real path', async () => {
    const skill = await loadManifestSkillWithPi({
      name: 'academic-style',
      document:
        '---\nname: academic-style\ndescription: Improve academic prose.\n---\nUse direct claims.',
      virtualUri: `writellm://skills/academic-style/${'a'.repeat(40)}/SKILL.md`
    })

    expect(skill).toMatchObject({
      name: 'academic-style',
      description: 'Improve academic prose.',
      content: 'Use direct claims.',
      filePath: `writellm://skills/academic-style/${'a'.repeat(40)}/SKILL.md`
    })
    expect(JSON.stringify(skill)).not.toContain('/Users/')
  })

  it('fails closed on any Pi metadata diagnostic', async () => {
    await expect(
      loadManifestSkillWithPi({
        name: 'directory-name',
        document: '---\nname: different-name\ndescription: Invalid directory match.\n---\nBody.',
        virtualUri: `writellm://skills/directory-name/${'b'.repeat(40)}/SKILL.md`
      })
    ).rejects.toThrow('Pi rejected')
  })
})
