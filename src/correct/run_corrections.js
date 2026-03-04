import fs from 'fs/promises'
import Papa from 'papaparse'
import ReportCorrector from './index.js'
import { ProgressQueue } from '../fetch/helpers.js'

const correct_queue = new ProgressQueue({
  format: 'Correcting |{bar}| {value}/{total} reports | {eta}s left',
  capacity: 1,
})

async function correct_current_reports(csv_path, out_path) {
  const file = await fs.readFile(csv_path, 'utf8')
  const reports = Papa.parse(file, { header: true }).data
  const headers = Object.keys(reports[0] ?? {})
  await fs.rm(out_path, { force: true })
  const correct_report = await ReportCorrector(false)

  const lazy_corrected = reports.map((report) => async () => {
    const correct = correct_report(report)
      return Object.fromEntries(
      headers.map((header) => [header, correct[header]]),
    )
  })
  const corrected = await correct_queue.all(lazy_corrected)
  await correct_report.close()
  await fs.writeFile(out_path, Papa.unparse(corrected))
}

correct_current_reports(
  './src/data/reports.csv',
  './src/data/reports-corrected.csv'
)
