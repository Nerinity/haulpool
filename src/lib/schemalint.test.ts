import { expect, it } from 'vitest'
import { lintSchemas } from 'deepspace/worker'
import { schemas } from '../schemas'
it('all schemas pass the DeepSpace schema linter', () => {
  expect(lintSchemas(schemas)).toEqual([])
})
