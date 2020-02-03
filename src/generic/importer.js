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
const unified = require('unified');
const parse = require('rehype-parse');
const rehype2remark = require('rehype-remark');
const stringify = require('remark-stringify');
const fs = require('fs-extra');
const mime = require('mime-types');
const os = require('os');
const path = require('path');
const scrape = require('website-scraper');
const byTypeFilenameGenerator = require('website-scraper/lib/filename-generator/by-type');
const SaveToExistingDirectoryPlugin = require('website-scraper-existing-directory');

const BlogHandler = require('./BlogHandler');
const { asyncForEach } = require('./utils');

let blobHandler;

if (process.env.AZURE_BLOB_SAS && process.env.AZURE_BLOB_URI) {
  blobHandler = new BlogHandler({
    azureBlobSAS: process.env.AZURE_BLOB_SAS,
    azureBlobURI: process.env.AZURE_BLOB_URI,
  });
}

async function getPages(logger, urls) {
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
    subdirectories: [
      { directory: 'img', extensions: ['.git', '.jpg', '.jpeg', '.png', '.svg'] },
    ],
    plugins: [
      new (class {
        // eslint-disable-next-line class-methods-use-this
        apply(registerAction) {
          let occupiedFilenames;
          let defaultFilename;
          let rootDirectory;

          registerAction('beforeStart', ({ options: opt }) => {
            occupiedFilenames = [];
            defaultFilename = opt.defaultFilename;
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

            let directory = 'img';
            if (resource.parent) {
              const u = resource.parent.url.replace('/index.html', '').replace(/\/$/g, '');
              directory = u.substring(u.lastIndexOf('/') + 1, u.length);
            }

            // else default behavior
            const filename = byTypeFilenameGenerator(resource, {
              subdirectories: [{ directory, extensions: ['.git', '.jpg', '.jpeg', '.png', '.svg'] }],
              defaultFilename,
            }, occupiedFilenames);
            occupiedFilenames.push(filename);
            // eslint-disable-next-line no-param-reassign
            resource.localPath = `${rootDirectory}/${filename}`;
            return { filename };
          });
        }
      })(),
      new SaveToExistingDirectoryPlugin(),
    ],
  };

  logger.info(`Starting to scrape urls ${urls.join(',')}`);
  const result = await scrape(options);
  logger.info(`Done with scraping. Downloaded ${result.length} page(s).`);

  return result;
}

async function getBlobURI(handler, buffer, contentType) {
  const blob = handler.createExternalResource(buffer, contentType);
  const exists = await handler.checkBlobExists(blob);
  if (!exists) {
    await handler.upload(blob);
  }
  return blob;
}

async function createMarkdownFile(logger, directory, resourceName, name, content, links = []) {
  logger.info(`Creating a new MD file: ${directory}/${name}.md`);
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
      await fs.mkdirs(`${directory}`);
      let { contents } = file;

      if (links && links.length > 0) {
        const folder = `${directory}/${name}`;

        if (!blobHandler) {
          // will put images in a local sub folder
          await fs.mkdirs(folder);
        }

        // copy resources (imgs...) folder or to azure
        await asyncForEach(links, async (l) => {
          const rName = path.parse(l.url).base;
          const filteredRName = rName.replace('@', '%40');
          // try to be smart, only copy images "referenced" in the content
          if (l.saved && file.contents.indexOf(filteredRName) !== -1) {
            if (blobHandler) {
              // if blob handler is defined, upload image and update reference
              const bitmap = fs.readFileSync(l.localPath);
              const ext = path.parse(rName).ext.replace('.', '');

              const externalResource = await getBlobURI(
                blobHandler,
                Buffer.from(bitmap),
                mime.lookup(ext),
              );
              contents = contents.replace(new RegExp(`${resourceName}/${filteredRName.replace('.', '\\.')}`, 'g'), externalResource.uri);
            } else {
              // otherwise copy image in a local sub folder
              await fs.copy(`${l.localPath}`, `${folder}/${rName}`);
            }
          }
        });
      }
      await fs.writeFile(p, contents);
      logger.info(`MD file created: ${p}`);
    });
}

async function createMarkdownFileFromResource(logger, directory, resource, content, customName) {
  const name = customName || path.parse(resource.filename).name;
  await createMarkdownFile(
    logger,
    directory,
    path.parse(resource.filename).name,
    name,
    content,
    resource.children,
  );
}

module.exports = { getPages, createMarkdownFile, createMarkdownFileFromResource };
