import fs from 'fs/promises'
import Papa from 'papaparse'
import ReportCorrector from './correct/index.js'
import {
  fetch_all_urls,
  fetch_page_urls,
  fetch_report,
} from './fetch/index.js'
import { parse_report_basic, parse_summary_basic } from './parse/index.js'
import { write_log } from './write/index.js'
import { ProgressQueue } from './fetch/helpers.js'

/** Finds all reports already present in our csv
 * @param {string} file_path the path to our reports csv
 * @return {Promise<Full_Report[]>} all urls that we've already seen
 */
async function fetch_seen_reports(file_path) {
  return await fs
    .readFile(file_path, 'utf8')
    .then(text => Papa.parse(text, { header: true }).data)
    .catch(_ => [])
}

/** Type imports
 * @typedef {import('cheerio').CheerioAPI} CheerioAPI
 * @typedef {import('./fetch/helpers.js').NetworkError} NetworkError
 * @typedef {import('./fetch/helpers.js').ElementError} ElementError
 * @typedef {import('./parse/helpers.js').Parser} Parser
 * @typedef {import('./parse/parse_report.js').Basic_Report} Report
 * @typedef {import('./parse/parse_summary.js').Basic_Summary} Summary
 */

/** @typedef {{report_url: string, pdf_url: string, reply_urls: string}} URLs */

const report_queue = new ProgressQueue({
  format: 'Reading reports |{bar}| {value}/{total} urls | {eta}s left',
  capacity: 3,
  max_rate: 0.2, // 1 report per 10 secs at most
})

/** Fetches and writes reports to the given `.csv` file
 * @template R, S
 * @param {string} reports_url the url to fetch from
 * @param {string} csv_path the `.csv` file to write reports to
 * @param {string} log_path where to write a log of the latest fetch
 * @param {string[]} columns the headers we're using for the `.csv` file
 * @param {Parser<R>} parse_report the parser to use for reports
 * @param {Parser<S>} parse_summary the parser to use for summaries
 */
export async function write_reports(
  reports_url,
  csv_path,
  correct_path,
  log_path,
  columns,
  parse_report,
  parse_summary
) {
  let reports = await fetch_seen_reports(csv_path)
  let correct = await fetch_seen_reports(correct_path)
  const correct_report = await ReportCorrector()

  const page_urls = await fetch_page_urls(reports_url)
  const all_urls = await fetch_all_urls(page_urls)
  const seen_urls = new Set(reports.map(report => report.report_url))
  const urls = all_urls.filter(url => !seen_urls.has(url))
  await write_log(log_path, page_urls.length, all_urls.length, urls.length)

  if (urls.length === 0) return console.log('Reports up to date!')
  const lazy_reports = urls.map((url, i) => async () => {
    try {
      const report = await fetch_report(url, parse_report, parse_summary)
      return [report, (correct_report(report))]
    } catch (e) {
      console.warn(`\nReport ${i} (${url}) failed with`, e)
      // ignore any errors from this, we'll either get it next time
      // or this report can't be effectively read at all
    }
  })
  let new_reports = await report_queue.all(lazy_reports)
  new_reports = new_reports.filter(report => report !== undefined)

  for (const [report, corrected] of new_reports.reverse()) {
    reports.unshift(report)
    correct.unshift(corrected)
  }

  // descending sort ref
  reports.sort(({ ref: a = '' }, { ref: b = '' }) => b.localeCompare(a))
  correct.sort(({ ref: a = '' }, { ref: b = '' }) => b.localeCompare(a))

  await fs.writeFile(csv_path, Papa.unparse(reports, { header: true, columns }))
  await fs.writeFile(
    correct_path,
    Papa.unparse(correct, { header: true, columns })
  )
}

/** @typedef {Summary & Report & URLs} Full_Report */
/** @type {(keyof Full_Report)[]} */
const headers = [
  'date_of_report',
  'ref',
  'deceased_name',
  'coroner_name',
  'coroner_area',
  'category',
  'this_report_is_being_sent_to',
  'report_url',
  'pdf_url',
  'reply_urls',
  'circumstances',
  'concerns',
  'inquest',
  'action',
  'response',
  'legal'
]

write_reports(
  'https://www.judiciary.uk/prevention-of-future-death-reports/',
  'src/data/reports.csv',
  'src/data/reports-corrected.csv',
  'src/data/latest.log',
  headers,
  parse_report_basic,
  parse_summary_basic
)
