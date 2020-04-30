/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
const { wrap } = require('@adobe/openwhisk-action-utils');
const { logger: oLogger } = require('@adobe/openwhisk-action-logger');
const { wrap: status } = require('@adobe/helix-status');
const { epsagon } = require('@adobe/helix-epsagon');

const cheerio = require('cheerio');
const moment = require('moment');
const path = require('path');
const rp = require('request-promise-native');

const HelixImporter = require('./generic/HelixImporter');
const BlogHandler = require('./generic/BlogHandler');
const { asyncForEach } = require('./generic/utils');

const OneDriveHandler = require('./handlers/OneDriveHandler');
const FSHandler = require('./handlers/FSHandler');
const ExcelHandler = require('./handlers/ExcelHandler');
const FastlyHandler = require('./handlers/FastlyHandler');

const OUTPUT_PATH = 'en';

const TYPE_AUTHOR = 'authors';
const TYPE_POST = 'drafts/migrated';
const TYPE_TOPIC = 'topics';
const TYPE_PRODUCT = 'products';

const URLS_XLSX = '/importer/urls.xlsx';
const URLS_XLSX_WORKSHEET = 'urls';
const URLS_XLSX_TABLE = 'listOfURLS';

const EMBED_PATTERNS = [{
  matchReg: /w.soundcloud.com\/player/gm,
  extract: async (src, logger) => {
    try {
      const html = await rp({
        uri: src,
        timeout: 60000,
        simple: false,
        headers: {
          // does not give the canonical rel without the UA.
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.132 Safari/537.36',
        },
      });
      if (html && html !== '') {
        const $ = cheerio.load(html);
        return $('link[rel="canonical"]').attr('href') || src;
      }
    } catch (error) {
      logger.warn(`Cannot resolve soundcloud embed ${src}`);
      return src;
    }
    return src;
  },
}];

async function handleAuthor(importer, $, postedOn, checkIfExists) {
  let postedBy = $('.author-link').text();
  postedBy = postedBy.split(',')[0].trim();
  const authorLink = $('.author-link').attr('href');

  const nodes = [];
  nodes.push($('<p>').append(`by ${postedBy}`));
  nodes.push($('<p>').append(postedOn));

  const authorFilename = postedBy.toLowerCase().trim().replace(/\s/g, '-');

  if (authorFilename && authorFilename !== '' && (!checkIfExists || !await importer.exists(`${OUTPUT_PATH}/${TYPE_AUTHOR}`, authorFilename))) {
    const html = await importer.getPageContent(authorLink);

    if (html && html !== '') {
      const $2 = cheerio.load(html);

      const $main = $2('.author-header');

      // convert author-img from div to img for auto-processing
      const $div = $2('.author-header .author-img');
      const urlstr = $div.css('background-image');
      const url = /\(([^)]+)\)/.exec(urlstr)[1];
      $main.prepend(`<img src="${url}">`);
      $div.remove();

      const content = $main.html();
      await importer.createMarkdownFile(`${OUTPUT_PATH}/${TYPE_AUTHOR}`, authorFilename, content);
    }
  }

  return nodes;
}

async function handleTopics(importer, $, checkIfExists, logger) {
  let topics = '';
  $('.article-footer-topics-wrap .text').each((i, t) => {
    topics += `${$(t).html()}, `;
  });

  topics = topics.slice(0, -2);

  await asyncForEach(
    topics.split(',')
      .filter((t) => t && t.length > 0)
      .map((t) => t.trim()),
    async (t) => {
      const topicName = `${t.replace(/\s/gm, '-').replace(/&amp;/gm, '').toLowerCase()}`;
      if (!checkIfExists || !await importer.exists(`${OUTPUT_PATH}/${TYPE_TOPIC}`, topicName)) {
        logger.info(`Found a new topic: ${topicName}`);
        await importer.createMarkdownFile(`${OUTPUT_PATH}/${TYPE_TOPIC}`, topicName, `<h1>${t}</h1>`);
      }
    },
  );

  return topics;
}

async function handleProducts(importer, $, checkIfExists, logger) {
  let output = '';
  const products = [];
  $('.sidebar-products-row .product-team-link').each((i, p) => {
    const $p = $(p);
    let { name } = path.parse($(p).attr('href'));

    const src = $p.find('img').attr('src');

    // edge case, some link redirect to homepage, try to get product from image src
    if (name === 'en') {
      name = path.parse(src).name;
    }

    name = name.replace(/-/g, ' ').replace(/\b[a-z](?=[a-z]{2})/g, (letter) => letter.toUpperCase());

    const fileName = name.replace(/\s/g, '-').toLowerCase();
    products.push({
      name,
      fileName,
      href: p.href,
      imgSrc: src,
    });
    output += `${name}, `;
  });

  output = output.slice(0, -2);

  await asyncForEach(
    products,
    async (p) => {
      if (!checkIfExists || !await importer.exists(`${OUTPUT_PATH}/${TYPE_PRODUCT}`, p.fileName)) {
        logger.info(`Found a new product: ${p.name}`);
        await importer.createMarkdownFile(`${OUTPUT_PATH}/${TYPE_PRODUCT}`, `${p.fileName}`, `<h1>${p.name}</h1><a href='${p.href}'><img src='${p.imgSrc}'></a>`);
      }
    },
  );

  return output;
}

async function doImport(importer, url, checkIfRelatedExists, logger) {
  const html = await importer.getPageContent(url);

  if (html && html !== '') {
    const $ = cheerio.load(html);

    let date = 'unknown';

    const postedOn = $('.post-date').text().toLowerCase();
    if (postedOn) {
      const d = moment(postedOn, 'MM-DD-YYYY');
      date = d.format('YYYY/MM/DD');
    } else {
      // fallback to article:published_time metadata
      const pubDate = $('[property="article:published_time"]').attr('content');
      if (pubDate) {
        const d = moment(pubDate);
        date = d.format('YYYY/MM/DD');
      }
    }

    const $main = $('.main-content');

    // remove all existing hr to avoid section collisions
    $main.find('hr').remove();

    // remove all hidden elements
    $main.find('.hidden-md-down, .hidden-xs-down').remove();

    // add a thematic break after first titles
    $('<hr>').insertAfter($('.article-header'));

    // add a thematic break after hero banner
    const $heroHr = $('<hr>').insertAfter($('.article-hero'));

    $('<hr>').insertAfter($heroHr);
    const nodes = await handleAuthor(importer, $, postedOn, checkIfRelatedExists, logger);
    let previous = $heroHr;
    nodes.forEach((n) => {
      previous = n.insertAfter(previous);
    });

    const topics = await handleTopics(importer, $, checkIfRelatedExists, logger);
    const products = await handleProducts(importer, $, checkIfRelatedExists, logger);

    const $topicsWrap = $('<p>');
    $topicsWrap.html(`Topics: ${topics}`);
    const $productsWrap = $('<p>');
    $productsWrap.html(`Products: ${products}`);

    $main.append($topicsWrap);
    $main.append($productsWrap);
    $('<hr>').insertBefore($topicsWrap);

    const headers = $('.article-header');
    if (headers.length === 0) {
      // posts with headers after image
      const $articleRow = $('.article-title-row');
      $('.article-content').prepend($articleRow);
      $('<hr>').insertAfter($articleRow);
    }
    $('.article-collection-header').remove();

    // remove author / products section
    $('.article-author-wrap').remove();
    // remove footer
    $('.article-footer').remove();
    // remove nav
    $('#article-nav-wrap').remove();
    // remove 'products in article'
    $('.article-body-products').remove();
    // remove comments section
    $('.comments').remove();

    // embeds
    await asyncForEach($('.embed-wrapper').toArray(), async (node) => {
      const $w = $(node);
      const $f = $w.find('iframe');
      let src = $f.attr('src');

      await asyncForEach(
        EMBED_PATTERNS,
        async (p) => {
          if (src.match(p.matchReg)) {
            src = await p.extract(src, logger);
          }
          return src;
        },
      );

      // replace iframe by "embed" image
      $w.append(`<img src="${src}" class="hlx-embed">`);
      $f.remove();
    });

    const content = $main.html();

    await importer.createMarkdownFile(`${OUTPUT_PATH}/${TYPE_POST}/${date}`, path.parse(url).name, content);

    return date;
  }
  return 'N/A';
}

/**
 * This is the main function
 * @param {string} name name of the person to greet
 * @returns {object} a greeting
 */
async function main(params = {}) {
  const startTime = new Date().getTime();
  const {
    url,
    force,
    checkIfRelatedExists,
    __ow_logger: logger,
    AZURE_BLOB_SAS: azureBlobSAS,
    AZURE_BLOB_URI: azureBlobURI,
    AZURE_ONEDRIVE_CLIENT_ID: oneDriveClientId,
    AZURE_ONEDRIVE_CLIENT_SECRET: oneDriveClientSecret,
    AZURE_ONEDRIVE_REFRESH_TOKEN: oneDriveRefreshToken,
    AZURE_ONEDRIVE_CONTENT_LINK: oneDriveContentLink,
    AZURE_ONEDRIVE_ADMIN_LINK: oneDriveAdminLink,
    FASTLY_TOKEN,
    FASTLY_SERVICE_ID,
    localStorage,
  } = params;

  if (!url) {
    throw new Error('Missing url parameter');
  }

  if (!azureBlobSAS || !azureBlobURI) {
    throw new Error('Missing Azure Blog Storage credentials');
  }

  try {
    let handler;
    let excelHandler;

    if (oneDriveClientId && oneDriveClientSecret) {
      if (!localStorage) {
        logger.info('OneDrive credentials provided - using OneDrive handler');
        handler = new OneDriveHandler({
          logger,
          clientId: oneDriveClientId,
          clientSecret: oneDriveClientSecret,
          refreshToken: oneDriveRefreshToken,
          sharedLink: oneDriveContentLink,
        });
      } else {
        logger.info('localStorage provided - using FShandler');
        handler = new FSHandler({
          logger,
          target: localStorage,
        });
      }

      excelHandler = new ExcelHandler({
        logger,
        clientId: oneDriveClientId,
        clientSecret: oneDriveClientSecret,
        refreshToken: oneDriveRefreshToken,
        sharedLink: oneDriveAdminLink,
      });
    } else {
      logger.info('No OneDrive credentials provided');
      throw new Error('Missing OneDrive credentials');
    }

    logger.info(`Received url ${url}`);

    if (!force) {
      // check if url has already been processed
      const rows = await excelHandler.getRows(URLS_XLSX, URLS_XLSX_WORKSHEET, URLS_XLSX_TABLE);

      // rows.value[n].values[0][0] -> year
      // rows.value[n].values[0][1] -> url
      // rows.value[n].values[0][2] -> import date
      const index = rows && rows.value
        ? rows.value.findIndex(
          (r) => (r.values.length > 0 && r.values[0].length > 1 ? r.values[0][1] === url : false),
        )
        : -1;
      const rec = index > -1 ? rows.value[index] : null;
      if (rec && rec.values[0][2]) {
        // url has already been imported
        return Promise.resolve({
          body: `${url} has already been imported.`,
        });
      }
    }

    const importer = new HelixImporter({
      storageHandler: handler,
      blobHandler: new BlogHandler({
        azureBlobSAS,
        azureBlobURI,
        log: {
          debug: () => {},
          info: () => {},
          error: (msg) => { logger.error(msg); },
          warn: (msg) => { logger.warn(msg); },
        },
      }),
      logger,
    });

    const date = await doImport(importer, url, checkIfRelatedExists, logger);

    await excelHandler.addRow(
      URLS_XLSX,
      URLS_XLSX_WORKSHEET,
      URLS_XLSX_TABLE,
      [[date, url, new Date().toISOString()]],
    );

    if (FASTLY_SERVICE_ID && FASTLY_TOKEN) {
      const fastly = new FastlyHandler({
        fastlyServiceId: FASTLY_SERVICE_ID,
        fastlyToken: FASTLY_TOKEN,
      });

      await fastly.addDictEntry(url, date);
    } else {
      logger.warn('Unable to create redirect, check FASTLY_SERVICE_ID and FASTLY_TOKEN');
    }


    logger.info(`Process done in ${(new Date().getTime() - startTime) / 1000}s.`);
    return {
      body: `Successfully imported ${url}`,
      statusCode: 200,
    };
  } catch (error) {
    logger.error(error.message);
    return {
      statusCode: 500,
      body: `Error for ${url} import: ${error.stack}`,
    };
  }
}

module.exports.main = wrap(main)
  .with(epsagon)
  .with(status)
  .with(oLogger.trace)
  .with(oLogger);
