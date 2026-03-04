import { fetch_html, ProgressQueue } from "./helpers.js";

/** Determines the urls of all the pages we need to search
 * @param {string} report_url the prevention of death reports page
 * @return {Promise<string[]>} the page urls to be loaded
 */
export async function fetch_page_urls(report_url) {
  const $ = await fetch_html(report_url)

  // determine how many pages we need to search and the urls for those pages
  const link_path = 'a.page-numbers'
  const nums = $(link_path)
    .get()
    .flatMap(link => Array.from($(link).text().matchAll(/\d+/g)))
    .map(num => Number(num[0]))
    .filter(isFinite)

  return Array.from(
    { length: Math.max(...nums) },
    (_, i) => `${report_url}page/${i + 1}/`
  )
}

/** Determines the urls of all reports that need to be loaded from a single page
 * @param {string} page_url the page to get report urls from
 * @return {Promise<string[]>} the urls from the page
 */
async function fetch_urls_from_page(page_url) {
  const $ = await fetch_html(page_url)

  // add all links on the page to the urls array
  const link_path = 'h3.card__title > a.card__link'
  return $(link_path)
    .get()
    .map(link => $(link).attr('href'))
}

const fetch_queue = new ProgressQueue({
  format: "Fetching urls |{bar}| {value}/{total} pages | {eta}s left",
  capacity: 3,
  max_rate: 3,
});

/** Determines the urls of all reports that need to be loaded
 * @param {string[]} page_urls the urls of all pages to fetch reports from
 * @return {Promise<string[]>} the report urls to be loaded
 */
export async function fetch_all_urls(page_urls) {
  const lazy_urls = page_urls.map((url) => () => fetch_urls_from_page(url));
  return (await fetch_queue.all(lazy_urls)).flat();
}
