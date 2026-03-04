import { load } from 'cheerio/lib/slim'
import { Presets, SingleBar } from 'cli-progress'
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js'
import ProgressBar from 'progress'

/**
 * @typedef {import('pdfjs-dist').PDFPageProxy} PDFPageProxy
 */

export class NetworkError extends Error {
  name = 'NetworkError'

  /** Creates a new network error from an existing error
   * @param {Error} err the error to generate from
   * @param {string} url the url we attempted to fetch
   * @returns {NetworkError}
   */
  static from(err, url) {
    return new NetworkError(`Error fetching ${url}: ${err.msg}`, { cause: err })
  }
}

export class ElementError extends Error {
  name = 'ElementError'
}

/** Wrapper to run the fetch n times, in case the first doesn't work
 * @throws {TypeError} a network error
 * @param {RequestInfo} url the url of the content to fetch
 * @param {number} n the number of retries to make
 * @param {RequestInit} init the initialisation options for fetch
 * @return {Promise<Response>} the result from the url
 */
async function retry_fetch(url, n = 50, init = {}) {
  let err
  for (let i = 0; i < n; i++)
    try {
      return await fetch(url, init)
    } catch (e) {
      err = e
    }
  throw NetworkError.from(err, url)
}

/** Fetches a webpage and loads it with the cheerio library
 * @throws {NetworkError}
 * @param {string} url the url of the page to fetch
 * @return the parsed html document
 */
export async function fetch_html(url) {
  const data = await retry_fetch(url)
  const text = await data.text()
  return load(text)
}

/** Retrieves the text content from a page, adding newlines as necessary
 * @param {PDFPageProxy} page the pdf page to read text from
 * @returns {Promise<string>} the text retrieved from the page
 */
async function load_page(page) {
  const content = await page.getTextContent()
  let y,
    text = ''

  for (const { str, transform } of content.items) {
    text += y && y !== transform[5] ? '\n' + str : str
    y = transform[5]
  }

  return text
}

/** Reads the text from multiple pages of a pdf, separating pages with a `\n\n`
 * @param {ArrayBuffer} data the array buffer to read as a pdf
 * @param {number} verbosity the debug level to pass to pdf.js
 * @return {Promise<string>} the text content of the pdf
 */
async function load_pdf(data, verbosity = 0) {
  const doc = await pdfjs.getDocument({ data, verbosity }).promise
  const page_nums = Array.from({ length: doc.numPages }, (_, i) => i + 1)
  const pages = await Promise.all(
    page_nums.map((num) => doc.getPage(num).then(load_page)),
  )
  await doc.destroy()
  return pages.join('\n\n')
}

/** Fetches a pdf and loads it with the pdf-parse library
 * @throws {NetworkError}
 * @param {string} url the url of the pdf to fetch
 * @return {Promise<string>} the parsed pdf document
 */
export async function fetch_pdf(url) {
  const data = await retry_fetch(url)
  const buff = await data.arrayBuffer()
  return await load_pdf(buff)
}

/**
 * @typedef AsyncQueueOptions
 * @property {number} [capacity=3] the maximum number of promises to run at once
 * @property {number} [max_rate=1] the max number of promises to run per second
 */
/**
 * @typedef PromiseHandler
 * @property {(value: any) => void} then a handler for promises resolving successfully
 * @property {(reason?: any) => void} catch a handler for promises failing to resolve
 * @property {() => void} finally a handler for promises resolving by any means
 */
/** @typedef {{[K in keyof PromiseHandler]: Set<PromiseHandler[K]>}} PromiseHandlers */
/**
 * @template T
 * @typedef {(promise: Promise<T>) => Promise<T>} PromiseWrapper
 */
/**
 * @template T
 * @typedef {Set<PromiseWrapper<T>>} PromiseWrappers
 */

/** An asynchronous queue that only runs a given number of promises `capacity` at once. */
export class AsyncQueue {
  /** @type {(() => Promise<void>)[]} lazy promises still to be resolved */
  #work = []

  /**
   * @param {AsyncQueueOptions} options options for initialising the queue
   */
  constructor({
    capacity = Number.MAX_SAFE_INTEGER,
    max_rate = Number.MAX_SAFE_INTEGER,
  }) {
    this.max_capacity = capacity
    this.capacity = capacity
    this.max_rate = max_rate

    // ensure capacity isn't violated
    this.on('finally', () => {
      this.capacity += 1
    })
  }

  /** @type {PromiseHandlers} the currently active promise handlers */
  #handlers = { then: new Set(), catch: new Set(), finally: new Set() }

  /** Registers handlers for promise resolution
   * @template {'then' | 'catch' | 'finally'} E
   * @param {E} event the event name to register a handler for
   * @param {PromiseHandler[E]} fn the handler to register for the event
   */
  on(event, fn) {
    this.#handlers[event].add(fn)
    return this
  }

  /** Deregisters handlers for promise resolution\
   * the handler is removed using reference equality\
   * so `fn` needs to be the same function registered with `.on(...)`
   *
   * @template {'then' | 'catch' | 'finally'} E
   * @param {E} event the event name to deregister a handler for
   * @param {PromiseHandler[E]} fn the handler to deregister for the event
   */
  off(event, fn) {
    this.#handlers[event].delete(fn)
    return this
  }

  /** Applies all current handlers when a promise settles
   * @template T
   * @param {Promise<T>} promise the promise to apply handlers to
   */
  #applyHandlers(promise) {
    return promise
      .then((value) => {
        for (const handler of this.#handlers.then) handler(value)
        return value
      })
      .catch((reason) => {
        for (const handler of this.#handlers.catch) handler(reason)
        throw reason
      })
      .finally(() => {
        for (const handler of this.#handlers.finally) handler()
      })
  }

  /** @type {PromiseWrappers} the currently active promise wrappers */
  #wrappers = new Set()

  /** Adds a wrapper for task execution
   * @template T
   * @param {PromiseWrapper<T>} wrapper the wrapper to apply on execution
   */
  addWrapper(wrapper) {
    this.#wrappers.add(wrapper)
    return this
  }

  /** Removes a wrapper for task execution
   * @template T
   * @param {PromiseWrapper<T>} wrapper the wrapper to remove
   */
  delWrapper(wrapper) {
    this.#wrappers.delete(wrapper)
    return this
  }

  /** Applies all current promise wrappers to a promise
   * @template T
   * @param {Promise<T>} promise the promise to wrap
   */
  #applyWrappers(promise) {
    for (const wrapper of this.#wrappers) promise = wrapper(promise)
    return promise
  }

  /** @type {number|undefined} */
  #interval

  /** If there's capacity, pulls a single task off the work queue and runs it */
  #pull() {
    if (this.capacity === 0) return
    this.capacity -= 1

    const task = this.#work.shift()
    if (task === undefined) {
      clearInterval(this.#interval)
      this.#interval = undefined
      return
    }
    task()
  }

  /** Start a pulling interval if one doesn't exist */
  #start_pulling() {
    if (this.#interval !== undefined) return; // back off
    const interval_ms = Math.max(1000 / this.max_rate, 1)
    this.#interval = setInterval(() => this.#pull(), interval_ms)
  }

  /** Runs a lazy promise, returning an eager promise that is resolved when the work is done
   * @template T
   * @param {() => Promise<T>} task the lazy promise to run
   * @returns {Promise<T>} the eagerly resolved promise
   */
  run(task) {
    return new Promise((resolve, reject) => {
      this.#work.push(() => {
        return this.#applyHandlers(this.#applyWrappers(task()))
          .then(resolve)
          .catch(reject)
      })
      this.#start_pulling()
    })
  }

  /** Runs an array of lazy promises with at most `num` in parallel
   * @template T
   * @param {(() => Promise<T>)[]} tasks the lazy promises to resolve
   * @return a promise with all lazy promises resolved
   */
  all(tasks) {
    return Promise.all(tasks.map((task) => this.run(task)))
  }
}

/** @typedef {import('cli-progress').Preset} Preset */
/**
 * @typedef ProgressQueueOptions
 * @property {string} [format='|{bar}| {value}/{total}'] the message format to use for the progress bar
 * @property {Preset} [preset=Preset.shades_grey] the preset to use for the bar format
 */

export class ProgressQueue extends AsyncQueue {
  /** @type {{tick: () => void, total: number}} a progress bar to update when tasks are finished / added */
  #progress

  /**
   * @param {string} format the format to use
   * @param {Preset} [preset] the preset to use
   */
  static #construct_progress(format, preset) {
    const progress = new SingleBar({ stopOnComplete: true, format }, preset)
    progress.setTotal(0)
    return {
      tick: () => {
        progress.increment()
      },
      get total() {
        return progress.getTotal()
      },
      set total(value) {
        if (!progress.isActive) {
          progress.start(value)
        } else {
          progress.setTotal(value)
        }
      },
    }
  }

  /** @param {AsyncQueueOptions & ProgressQueueOptions} options */
  constructor({
    format = '|{bar}| {value}/{total}',
    preset = Presets.shades_grey,
    ...options
  }) {
    super(options)
    this.#progress = ProgressQueue.#construct_progress(format, preset)
    this.on('finally', () => this.#progress.tick())
  }

  /** Runs a lazy promise, returning an eager promise that is resolved when the work is done
   * @override
   * @template T
   * @param {() => Promise<T>} task the lazy promise to run
   * @returns {Promise<T>} the eagerly resolved promise
   */
  run(task) {
    this.#progress.total += 1
    return super.run(task)
  }

  /** Runs an array of lazy promises with at most `num` in parallel
   * @template T
   * @param {(() => Promise<T>)[]} tasks the lazy promises to resolve
   * @return a promise with all lazy promises resolved
   */
  all(tasks) {
    this.#progress.total += tasks.length
    return Promise.all(tasks.map((task) => super.run(task)))
  }
}

/**
 * Maps a common async function in series on a list of data, updating a
 * progress bar when each of the tasks finish.
 *
 * We sometimes will have to use a sequential fetch instead of a parallel one
 * as some sites will return no webpage if we make too many requests at once.
 *
 * @param {T[]} xs the data to be processed
 * @param {(d: T) => Promise<R>} func the task to be performed
 * @param {string} msg the message format for the progress bar to use
 * @returns {Promise<R[]>} the result of applying func to all of the data
 */
export async function map_series(xs, func, msg = undefined) {
  const progress = msg ? new ProgressBar(msg, xs.length) : { tick() {} }
  const res = []
  for (const x of xs) {
    const r = await func(x)
    res.push(r)
    progress.tick()
  }
  return res
}
