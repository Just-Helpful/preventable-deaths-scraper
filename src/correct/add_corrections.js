import { fileURLToPath } from 'url'
import { dirname } from 'path'
import fs from 'fs/promises'

/* Argument parsing */

import { program, Argument } from 'commander'

const path = dirname(fileURLToPath(import.meta.url))
const names = await fs.readdir(`${path}/failed_parses`)
const fields = names.map(name => name.split('.')[0])
const field_arg = new Argument(
  '<field>',
  'Field to add corrections to'
).choices([...fields, 'all'])

program
  .description('Add manual corrections to pre-existing corrections')
  .addArgument(field_arg.argRequired())
  .parse()

const field = program.args[0]

/* Command line GUI */

import inquirer from 'inquirer'

const choices = [
  {
    name: 'mark incorrect',
    value: { name: 'incorrect' }
  },
  { name: 'mark correct', value: { name: 'correct', action: text => [text] } },
  {
    name: 'correct typos',
    value: {
      name: 'replace',
      async action() {
        const { replace } = await inquirer.prompt({
          type: 'input',
          name: 'replace',
          message: 'Corrected text:'
        })
        return [replace]
      }
    }
  },
  {
    name: 'add categories',
    value: {
      name: 'categories',
      async action() {
        const { categories } = await inquirer.prompt({
          type: 'input',
          name: 'categories',
          message: 'Categories seperated by `|`:'
        })
        return categories.split('|')
      }
    }
  },
  { name: 'skip', value: { name: 'skipped' } },
  {
    name: 'back',
    value: { name: 'skipped', update_index: i => i - 1 }
  },
  {
    name: 'quit',
    value: {
      name: 'skipped',
      update_index: _ => Number.MAX_VALUE
    }
  }
]

const padnum = (num, len, pad = ' ') => num.toString().padStart(len, pad)

/**
 * Gets the decisions for a list of texts
 * @param {string[]} failed a list of texts that failed to parse
 * @returns {Promise<{skipped: string[], incorrect: string[], correct: {[key: string]: string}}>} a list of texts that were skipped, incorrect, and correct
 */
async function categorise_failures(failed) {
  failed.sort((a, b) => a.length - b.length)
  let decisions = failed.map(text => [text, 'skipped', {}])
  const strlen = decisions.length.toString().length
  let i = 0

  while (i < decisions.length) {
    const [text] = decisions[i]
    const {
      type: { name, action = _ => [], update_index = i => i + 1 }
    } = await inquirer.prompt({
      type: 'list',
      name: 'type',
      message: `[${padnum(i + 1, strlen)}/${
        decisions.length
      }] For the text '${text}':`,
      choices
    })

    decisions[i] = [text, name, await action(text)]
    i = update_index(i)
  }

  let skipped = []
  let incorrect = []
  let correct = {}

  for (const [text, name, replacements] of decisions) {
    switch (name) {
      case 'skipped':
        skipped.push(text)
        break
      case 'incorrect':
        incorrect.push(text)
        break
      case 'replace':
        correct[text] = replacements[0]
        break
      case 'correct':
      case 'categories':
        replacements.forEach(replacement => {
          correct[replacement] = replacement
        })
    }
  }

  return { skipped, incorrect, correct }
}

async function update_corrections_for(field) {
  const { default: failed } = await import(`./failed_parses/${field}.json`, {
    with: { type: 'json' }
  })

  console.log(`- Manual corrections for '${field}' -`)

  const { skipped, incorrect, correct } = await categorise_failures(failed)

  await fs.writeFile(
    `${path}/failed_parses/${field}.json`,
    JSON.stringify(skipped, null, 2)
  )

  const { default: incorrect_fields = [] } = await import(
    `./incorrect_fields/${field}.json`,
    { assert: { type: 'json' } }
  ).catch(_ => [])
  incorrect_fields.push(...incorrect)
  await fs.writeFile(
    `${path}/incorrect_fields/${field}.json`,
    JSON.stringify(incorrect_fields, null, 2)
  )

  const { default: corrections = [] } = await import(
    `./manual_replace/${field}.json`,
    { assert: { type: 'json' } }
  ).catch(_ => [])
  for (const key in correct) {
    for (const correction of corrections) {
      if (correction[key]) delete correct[key]
    }
  }
  if (Object.keys(correct).length > 0) corrections.push(correct)
  await fs.writeFile(
    `${path}/manual_replace/${field}.json`,
    JSON.stringify(corrections, null, 2)
  )
}

if (field === 'all')
  for (const field of fields) {
    await update_corrections_for(field)
  }
else await update_corrections_for(field)
