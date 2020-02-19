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
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const scrape = require('website-scraper');
const SaveToExistingDirectoryPlugin = require('website-scraper-existing-directory');

const { asyncForEach } = require('./utils');

class HelixImporter {
  constructor(opts) {
    this.storageHandler = opts.storageHandler;
    this.blobHandler = opts.blobHandler;
    this.logger = opts.logger;
  }

  async getPages(urls) {
    const options = {
      urls,
      directory: await fs.mkdtemp(path.join(os.tmpdir(), 'htmlimporter-get-pages-')),
      recursive: false,
      urlFilter(url) {
        return url.indexOf('adobe') !== -1;
      },
      sources: [
        // only keep the imgs
        { selector: 'img', attr: 'src' },
        { selector: '[style]', attr: 'style' },
        { selector: 'style' },
      ],
      plugins: [
        new (class {
          // eslint-disable-next-line class-methods-use-this
          apply(registerAction) {
            let rootDirectory;

            registerAction('beforeStart', ({ options: opt }) => {
              rootDirectory = opt.directory;
            });
            registerAction('generateFilename', async ({ resource }) => {
              if (resource.filename === 'index.html') {
                // replace index.html by last segment in path
                // and remove last / if it is the last character
                const u = resource.url.replace('/index.html', '').replace(/\/$/g, '');
                const name = u.substring(u.lastIndexOf('/') + 1, u.length);
                // eslint-disable-next-line no-param-reassign
                resource.localPath = `${rootDirectory}/${name}.html`;
                return { filename: `${name}.html` };
              }
            });
          }
        })(),
        new SaveToExistingDirectoryPlugin(),
      ],
    };

    this.logger.info(`Starting to scrape urls ${urls.join(',')}`);
    const result = await scrape(options);
    this.logger.info(`Done with scraping. Downloaded ${result.length} page(s).`);

    return result;
  }

  async createMarkdownFile(directory, resourceName, name, content, links = []) {
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

        if (links && links.length > 0) {
          // copy resources (imgs...) to blob handler (azure)

          await asyncForEach(links, async (l) => {
            if (file.contents.indexOf(l.url) !== -1) {
              try {
                const externalURL = await this.blobHandler.copyFromURL(l.url);
                contents = contents.replace(new RegExp(`${l.url.replace('.', '\\.')}`, 'g'), externalURL);
              } catch (error) {
                this.logger.error(`Error while copying ${l.url} to blob handler`, error.message);
              }
            }
          });
        }
        await this.storageHandler.put(p, contents);
        this.logger.info(`MD file created: ${p}`);
      });
  }

  async createMarkdownFileFromResource(directory, resource, content, customName) {
    const name = customName || path.parse(resource.filename).name;
    await this.createMarkdownFile(
      directory,
      path.parse(resource.filename).name,
      name,
      content,
      resource.children,
    );
  }
}

module.exports = HelixImporter;
