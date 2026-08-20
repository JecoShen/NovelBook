import path from 'node:path'
import { compileProfileArtifacts } from 'nbook/server/agent/profiles/profile-artifact-compiler'
import { compileVariableDefinitions } from 'nbook/server/agent/variables/definition-artifact'
import { PROFILE_VARIABLE_IDE_TYPES_FILE } from 'nbook/server/agent/variables/generated-types'
import { generateProfileVariableIdeTypes } from 'nbook/server/agent/variables/ide-types'

const profileRoot = path.resolve(process.cwd(), 'assets', 'workspace', '.nbook', 'agent', 'profiles')
const variableDefinitionRoot = path.resolve(process.cwd(), 'assets', 'workspace', '.nbook', 'agent', 'variables')

await compileVariableDefinitions({
  definitionRoot: variableDefinitionRoot,
  rootLabel: 'assets/workspace/.nbook/agent/variables',
  skipFresh: true,
})
await compileProfileArtifacts({
  profileRoot,
  rootLabel: 'assets/workspace/.nbook/agent/profiles',
  skipFresh: true,
})

const ideTypes = await generateProfileVariableIdeTypes({
  outputPath: path.resolve(process.cwd(), PROFILE_VARIABLE_IDE_TYPES_FILE),
  variableDefinitionRoots: [variableDefinitionRoot],
  profileRoots: [profileRoot],
})

console.log(`generated profile variable IDE types: ${path.relative(process.cwd(), ideTypes.outputPath)} (${ideTypes.includedFiles.length} artifact type file(s))`)
