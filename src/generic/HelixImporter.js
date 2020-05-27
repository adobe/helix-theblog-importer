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
const fs = require('fs-extra');
const path = require('path');
const unified = require('unified');
const parse = require('rehype-parse');
const rehype2remark = require('rehype-remark');
const sanitize = require('sanitize-filename');
const stringify = require('remark-stringify');
const rp = require('request-promise-native');
const cheerio = require('cheerio');

const { asyncForEach } = require('./utils');

class HelixImporter {
  constructor(opts) {
    this.storageHandler = opts.storageHandler;
    this.blobHandler = opts.blobHandler;
    this.logger = opts.logger;
    this.useCache = !!opts.cache;
    this.cache = opts.cache;
  }

  async getPageContent(url) {
    this.logger.info(`Get page content for ${url}`);

    try {
      if (this.useCache) {
        const localPath = path.resolve(this.cache, `${new URL(url).pathname.replace(/\//gm, '')}.html`);
        if (await fs.exists(localPath)) {
          return fs.readFile(localPath);
        }
      }
      const html = await rp({
        uri: url,
        timeout: 60000,
        followRedirect: false,
      });
      if (this.useCache) {
        const localPath = path.resolve(this.cache, `${new URL(url).pathname.replace(/\//gm, '')}.html`);
        await fs.mkdirs(path.dirname(localPath));
        await fs.writeFile(localPath, html);
      }
      return html;
    } catch (error) {
      this.logger.error(`Request error or timeout for ${url}: ${error.message}`);
      throw new Error(`Cannot get content for ${url}: ${error.message}`);
    }
  }

  async createMarkdownFile(directory, name, content, prepend, imageLocation) {
    const sanitizedName = sanitize(name);
    this.logger.info(`Creating a new MD file: ${directory}/${sanitizedName}.md`);
    // use custom tag and rendering because text is always encoded by default: we need the raw url
    stringify.Compiler.prototype.visitors.hlxembed = (node) => node.value;
    return unified()
      .use(parse, { emitParseErrors: true, duplicateAttribute: false })
      .use(rehype2remark, {
        handlers: {
          hlxembed: (h, node) => h(node, 'hlxembed', node.children[0].value),
        },
      })
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
        const p = `${directory}/${sanitizedName}.md`;
        let { contents } = file;

        // process image links
        const $ = cheerio.load(content);
        const imgs = $('img');
        if (imgs && imgs.length > 0) {
          await asyncForEach(imgs, async (img, index) => {
            const $img = $(img);
            const src = $img.attr('src');
            const isEmbed = $img.hasClass('hlx-embed');
            if (!isEmbed && src !== '' && file.contents.indexOf(src) !== -1) {
              let newSrc = '';
              if (!imageLocation) {
                // copy resources (imgs...) to blob handler
                let blob;
                try {
                  blob = await this.blobHandler.getBlob(encodeURI(src));
                } catch (error) {
                  // ignore non exiting images, otherwise throw an error
                  if (error.message.indexOf('StatusCodeError: 404') === -1) {
                    this.logger.error(`Cannot upload blob for ${src}: ${error.message}`);
                    throw new Error(`Cannot upload blob for ${src}: ${error.message}`);
                  }
                }
                if (blob) {
                  newSrc = blob.uri;
                } else {
                  this.logger.warn(`Image could not be copied to blob handler: ${src}`);
                }
              } else {
                let response;
                try {
                  response = await rp({
                    uri: src,
                    timeout: 60000,
                    followRedirect: true,
                    encoding: null,
                    resolveWithFullResponse: true,
                  });
                } catch (error) {
                  // ignore 404 images but throw an error for other issues
                  if (error.statusCode !== 404) {
                    this.logger.error(`Cannot download image for ${src}: ${error.message}`);
                    throw new Error(`Cannot download image for ${src}: ${error.message}`);
                  }
                }

                if (response) {
                  let { ext } = path.parse(src);
                  if (!ext) {
                    const dispo = response.headers['content-disposition'];
                    if (dispo) {
                      // content-disposition:"inline; filename="xyz.jpeg""
                      try {
                        // eslint-disable-next-line prefer-destructuring
                        ext = `.${dispo.match(/\.(.*)"/)[1]}`;
                      } catch (e) {
                        this.logger.warn(`Cannot find extension for ${src} with content-disposition`);
                      }
                    } else {
                      // use content-type
                      const type = response.headers['content-type'];
                      try {
                        // eslint-disable-next-line prefer-destructuring
                        ext = `.${type.match(/\/(.*)/)[1]}`;
                      } catch (e) {
                        this.logger.warn(`Cannot find an extension for ${src} with content-type`);
                      }
                    }
                  }
                  const imgName = `${sanitizedName}${index > 0 ? `-${index}` : ''}${ext}`;
                  newSrc = `${imageLocation}/${imgName}`;
                  await this.storageHandler.put(newSrc, response.body);
                  this.logger.info(`Image file created: ${newSrc}`);
                  // absolute link
                  newSrc = `/${newSrc}`;
                }
              }
              contents = contents.replace(new RegExp(`${src.replace('.', '\\.')}`, 'g'), newSrc);
            }
          });
        }
        if (prepend) {
          contents = prepend + contents;
        }

        await this.storageHandler.put(p, contents);
        this.logger.info(`MD file created: ${p}`);
      });
  }

  async exists(directory, name) {
    const sanitizedName = sanitize(name);
    this.logger.info(`Checking if MD file exists: ${directory}/${sanitizedName}.md`);
    const p = `${directory}/${sanitizedName}.md`;
    return this.storageHandler.exists(p);
  }
}

module.exports = HelixImporter;
