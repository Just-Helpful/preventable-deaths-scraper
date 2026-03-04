/**
 * @template R
 * @typedef {(rows: string[]) => R | undefined} Parser
 */
/**
 * @template O
 * @typedef {{[key: string]: keyof O}} HeadersFor
 */

/** Creates a parser that recognises a table with headings
 * @template T
 * @param {HeadersFor<T>} headers the table heading regexes and their corresponding keys
 * @return {Parser<T>} the relevant parser
 */
export function table_parser(headers) {
  return function (text_rows) {
    const rows = text_rows
      .flatMap(row => row.split('\n\n'))
      .filter(row => row !== '')

    const entries = rows.flatMap(row =>
      Object.entries(headers).flatMap(([header, key]) => {
        const match = row.match(RegExp(`^\\s*(?:${header})\\s*(.*)`, 'si'))
        return match ? [[key, match[1]]] : []
      })
    )
    return Object.fromEntries(entries)
  }
}
