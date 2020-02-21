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
// eslint-disable-next-line max-classes-per-file
const unified = require('unified');
const parse = require('rehype-parse');
const rehype2remark = require('rehype-remark');
const stringify = require('remark-stringify');
const rp = require('request-promise-native');
const cheerio = require('cheerio');

const { asyncForEach } = require('./utils');

class HelixImporter {
  constructor(opts) {
    this.storageHandler = opts.storageHandler;
    this.blobHandler = opts.blobHandler;
    this.logger = opts.logger;
  }

  async getPageContent(url) {
    this.logger.info(`Get page content for ${url}`);
    const html = await rp({
      uri: url,
      timeout: 60000,
    });
    return html;
  }

  async createMarkdownFile(directory, name, content) {
    this.logger.info(`Creating a new MD file: ${directory}/${name}.md`);
    return unified()
      .use(parse, { emitParseErrors: true, duplicateAttribute: false })
      .use(rehype2remark)
      .use(stringify, {
        bullet: '-',
        fence: '`',
        fences: true,
        incrementListMarker: true,
        rule: '-',
        ruleRepetition: 3,
        ruleSpaces: false,
      })
      .process(content)
      .then(async (file) => {
        const p = `${directory}/${name}.md`;
        let { contents } = file;

        // process image links
        const $ = cheerio.load(content);
        const imgs = $('img');
        if (imgs && imgs.length > 0) {
          // copy resources (imgs...) to blob handler (azure)
          await asyncForEach(imgs, async (img) => {
            const src = $(img).attr('src');
            if (file.contents.indexOf(src) !== -1) {
              try {
                const externalURL = await this.blobHandler.copyFromURL(src);
                contents = contents.replace(new RegExp(`${src.replace('.', '\\.')}`, 'g'), externalURL);
              } catch (error) {
                this.logger.error(`Error while copying ${src} to blob handler`, error.message);
              }
            }
          });
        }
        await this.storageHandler.put(p, contents);
        this.logger.info(`MD file created: ${p}`);
      });
  }
}

module.exports = HelixImporter;
