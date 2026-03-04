import { try_matching } from './approx_match.js'

const zip = (...xss) =>
  Array.from({ length: Math.max(...xss.map(xs => xs.length)) }, (_, i) =>
    xss.map(xs => xs[i])
  )

/**
 * Template literal tag that interpolates regexes into a single regex.
 *
 * All flags will be combined and regexes will be enclosed in non-capturing
 * groups to prevent side effects (i.e. re\`a${'b|c'}d\` matches 'abd', 'acd').
 * @param {TemplateStringsArray} strings The template to interpolate
 * @param  {...RegExp} regexes The regexes to interpolate
 */
export function re(strings, ...regexes) {
  const flags = new Set(regexes.map(r => r.flags ?? '').join(''))
  const source = zip(strings.raw, regexes).reduce((res, [str, regex]) => {
    if (regex === undefined) return res + str
    if (regex.source) return res + str + `(?:${regex.source})`
    return res + str + regex
  }, '')
  return new RegExp(source, Array.from(flags).join(''))
}

/**
 * Gets the start indices for each word within `text.split(regex)` within `text`
 * @param {string} text the text that would be split
 * @param {RegExp} regex the regex that would be split on
 * @returns {number[]} the indices of the split
 */
export function split_indices(text, regex) {
  regex = new RegExp(regex) // copy so regex isn't mutated
  let indices = [0]
  let match
  while ((match = regex.exec(text)) !== null) {
    indices.push(match.index + match[0].length)
  }
  return indices
}

/**
 * @typedef {Object} CorrectionData
 * @property {string[]} failed the list of failed matches
 * @property {Set<string>} incorrect the list of incorrect matches
 * @property {{[key: string]: string}[]} corrections the list of manual corrections
 */

/**
 * Loads data common to all correction methods, used to log failed matches and
 * short circuit matches for manually corrected fields
 * @param {string} field the field currently being corrected
 * @returns {Promise<CorrectionData>} the data needed to correct the field
 */
export async function load_correction_data(field) {
  const { default: failed } = await import(`./failed_parses/${field}.json`, {
    with: { type: 'json' }
  })

  let { default: incorrect } = await import(
    `./incorrect_fields/${field}.json`,
    { with: { type: 'json' } }
  )
  incorrect = new Set(incorrect)

  const { default: corrections } = await import(
    `./manual_replace/${field}.json`,
    { with: { type: 'json' } }
  )

  return { failed, incorrect, corrections }
}

/**
 * Attempts to merge all unmatched names together, into the corrections needed
 * to match them all.
 *
 * We do this on the basis of:
 * - if a name roughly matches another name and is longer, we keep it
 * - if a name is the initials of another name, we keep the full name
 *
 * @param {string[]} texts the unmatched texts to merge together
 * @param {(field: string) => string[]} [simplify] generates simplified versions of the given field to merge
 * @return {string[]} the corrections needed to match the texts
 */
export function merge_failed(texts, simplify = field => [field]) {
  /** @type {{[key: string]: string}} */
  let corrections = {}

  for (const name of texts) {
    for (const possible of [name, ...simplify(name)]) {
      const match = try_matching(possible, corrections)
      // if we find an existing simplified match, remove it
      if (match !== undefined && match.length < possible.length) {
        delete corrections[match]
      }
    }

    corrections[name] = name
  }

  return Array.from(Object.keys(corrections))
}
