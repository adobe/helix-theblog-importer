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
const parse = require('csv-parse/lib/sync');
const stringify = require('csv-stringify/lib/sync');
const fs = require('fs-extra');
const jsdom = require('jsdom');
const jquery = require('jquery');
const path = require('path');

const HelixImporter = require('./generic/HelixImporter');
const BlogHandler = require('./generic/BlogHandler');
const { asyncForEach } = require('./generic/utils');

const FSHandler = require('./handlers/FSHandler');
const OneDriveHandler = require('./handlers/OneDriveHandler');

const { JSDOM } = jsdom;

const OUTPUT_PATH = 'en';

const TYPE_AUTHOR = 'authors';
const TYPE_POST = 'archive';
const TYPE_TOPIC = 'topics';
const TYPE_PRODUCT = 'products';

const URLS_CSV = '/importer/urls.csv';

async function handleAuthor(importer, $, logger) {
  let postedBy = $('.author-link').text();
  postedBy = postedBy.split(',')[0].trim();
  const authorLink = $('.author-link')[0].href;
  const postedOn = $('.post-date').text().toLowerCase();

  const nodes = [];
  nodes.push($('<p>').append(`by ${postedBy}`));
  nodes.push($('<p>').append(postedOn));

  const authorFilename = postedBy.toLowerCase().trim().replace(/\s/g, '-');
  const fullPath = `${OUTPUT_PATH}/${TYPE_AUTHOR}/${authorFilename}.md`;
  if (!await fs.exists(fullPath)) {
    logger.info(`File ${fullPath} does not exist. Retrieving it now.`);
    await asyncForEach(await importer.getPages([authorLink]), async (resource) => {
      const text = await fs.readFile(`${resource.localPath}`, 'utf8');
      const dom = new JSDOM(text);
      const { document } = dom.window;
      const $2 = jquery(document.defaultView);

      const $main = $2('.author-header');

      // convert author-img from div to img for auto-processing
      const $div = $2('.author-header .author-img');
      const urlstr = $div.css('background-image');
      const url = /\(([^)]+)\)/.exec(urlstr)[1];
      $main.prepend(`<img src="${url}">`);
      $div.remove();

      const content = $main.html();
      await importer.createMarkdownFileFromResource(`${OUTPUT_PATH}/${TYPE_AUTHOR}`, resource, content, authorFilename);
    });
  } else {
    logger.info(`File ${fullPath} exists, no need to compute it again.`);
  }

  return nodes;
}

async function handleTopics(importer, $, logger) {
  let topics = '';
  $('.article-footer-topics-wrap .text').each((i, t) => {
    topics += `${t.innerHTML}, `;
  });

  topics = topics.slice(0, -2);

  await asyncForEach(
    topics.split(',')
      .filter((t) => t && t.length > 0)
      .map((t) => t.trim()),
    async (t) => {
      const fullPath = `${OUTPUT_PATH}/${TYPE_TOPIC}/${t.replace(/\s/g, '-').toLowerCase()}.md`;
      if (!await fs.exists(fullPath)) {
        logger.info(`Found a new topic: ${t}`);
        await importer.createMarkdownFileFromResource(`${OUTPUT_PATH}/${TYPE_TOPIC}`, {
          filename: `${t.replace(/\s/gm, '-').replace(/&amp;/gm, '').toLowerCase()}.md`,
        }, `<h1>${t}</h1>`);
      } else {
        logger.info(`Topic already exists: ${t}`);
      }
    },
  );

  return topics;
}

async function handleProducts(importer, $, localPath, logger) {
  let output = '';
  const products = [];
  $('.sidebar-products-row .product-team-link').each((i, p) => {
    const $p = $(p);
    let { name } = path.parse(p.href);

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
      imgSrc: `${fileName}/${path.parse(src).base}`,
      imgLocalPath: `${localPath}/${src}`,
    });
    output += `${name}, `;
  });

  output = output.slice(0, -2);

  await asyncForEach(
    products,
    async (p) => {
      const fullPath = `${OUTPUT_PATH}/${TYPE_PRODUCT}/${p.fileName}.md`;
      if (!await fs.exists(fullPath)) {
        logger.info(`Found a new product: ${p.name}`);
        await importer.createMarkdownFileFromResource(`${OUTPUT_PATH}/${TYPE_PRODUCT}`, {
          filename: `${p.fileName}.md`,
          children: [{
            saved: true,
            url: p.imgSrc,
            localPath: p.imgLocalPath,
          }],
        }, `<h1>${p.name}</h1><a href='${p.href}'><img src='${p.imgSrc}'></a>`);
      } else {
        logger.info(`Product already exists: ${p.name}`);
      }
    },
  );

  return output;
}

async function doImport(importer, url, logger) {
  const resources = await importer.getPages([url]);
  const resource = resources && resources.length > 0 ? resources[0] : null;

  if (!resource) {
    return Promise.resolve({
      body: `Could not find a resource for provided url ${url}`,
    });
  }
  logger.info(`found resource ${resource}`);

  // encoding issue, do not use resource.text
  const text = await fs.readFile(`${resource.localPath}`, 'utf8');
  const dom = new JSDOM(text);
  const { document } = dom.window;
  const $ = jquery(document.defaultView);

  let year = new Date().getFullYear();
  // extract year from article:published_time metadata
  const pubDate = $('[property="article:published_time"]').attr('content');
  if (pubDate) {
    year = new Date(pubDate).getFullYear();
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
  const nodes = await handleAuthor(importer, $, logger);
  let previous = $heroHr;
  nodes.forEach((n) => {
    n.insertAfter(previous);
    previous = n;
  });

  const topics = await handleTopics(importer, $, logger);
  const products = await handleProducts(
    importer,
    $,
    path.parse(resource.localPath).dir,
    logger,
  );

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

  const content = $main.html();

  await importer.createMarkdownFileFromResource(`${OUTPUT_PATH}/${TYPE_POST}/${year}`, resource, content);

  return year;
}

/**
 * This is the main function
 * @param {string} name name of the person to greet
 * @returns {object} a greeting
 */
async function main(params = {}) {
  const {
    url,
    __ow_logger: logger,
    AZURE_BLOB_SAS: azureBlobSAS,
    AZURE_BLOB_URI: azureBlobURI,
    AZURE_ONEDRIVE_CLIENT_ID: oneDriveClientId,
    AZURE_ONEDRIVE_CLIENT_SECRET: oneDriveClientSecret,
    AZURE_ONEDRIVE_REFRESH_TOKEN: oneDriveRefreshToken,
    AZURE_ONEDRIVE_SHARED_LINK: oneDriveSharedLink,
  } = params;

  if (!url) {
    throw new Error('Missing url parameter');
  }

  if (!azureBlobSAS || !azureBlobURI) {
    throw new Error('Missing Azure Blog Storage credentials');
  }

  try {
    let handler = new FSHandler({
      logger,
    });

    if (oneDriveClientId && oneDriveClientSecret) {
      logger.info('OneDrive credentials provided - using OneDrive handler');
      handler = new OneDriveHandler({
        logger,
        clientId: oneDriveClientId,
        clientSecret: oneDriveClientSecret,
        refreshToken: oneDriveRefreshToken,
        sharedLink: oneDriveSharedLink,
      });
    } else {
      logger.info('No OneDrive credentials provided - using default handler');
    }

    logger.info(`Received url ${url}`);

    // check if url has already been processed
    let urls = await handler.get(URLS_CSV);
    let records = parse(urls, {
      columns: ['year', 'url', 'importDate'],
      skip_empty_lines: true,
      relax_column_count: true,
    });

    let index = records.findIndex((r) => r.url === url);
    const rec = index > -1 ? records[index] : null;
    if (rec && rec.importDate) {
      // url has already been imported
      return Promise.resolve({
        body: `${url} has already been imported.`,
      });
    }

    const importer = new HelixImporter({
      storageHandler: handler,
      blobHandler: new BlogHandler({
        azureBlobSAS,
        azureBlobURI,
      }),
      logger,
    });

    const year = await doImport(importer, url, logger);

    // read the file again: import might be a long process
    // something maybe have changed the csv file in the meantime
    urls = await handler.get(URLS_CSV);
    records = parse(urls, {
      columns: ['year', 'url', 'importDate'],
      skip_empty_lines: true,
      relax_column_count: true,
    });

    index = records.findIndex((r) => r.url === url);

    if (index > -1) {
      // url was already in file
      records[index].importDate = new Date().toISOString();
    } else {
      // new record
      records.push({
        year,
        url,
        importDate: new Date().toISOString(),
      });
    }
    const csv = stringify(records, {
      columns: ['year', 'url', 'importDate'],
    });
    await handler.put(URLS_CSV, csv);

    logger.info('Process done!');
    return Promise.resolve({
      body: `Successfully imported ${url}`,
    });
  } catch (error) {
    logger.error(error.message);
    throw error;
  }
}

module.exports.main = wrap(main)
  .with(epsagon)
  .with(status)
  .with(oLogger.trace)
  .with(oLogger);
