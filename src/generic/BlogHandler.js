/*
 * Copyright 2019 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
const crypto = require('crypto');
const request = require('request');
const rp = require('request-promise-native');

// cache external urls
const blobCache = {};

/**
 * @typedef ExternalResource
 * @property {string} uri - URI of the external resource
 * @property {string} sourceUri - URI of the original resource
 * @property {string} sha1 - sha1 checksum
 * @property {string} contentType - content type
 * @property {number} contentLength - content length
 * @property {Buffer} body - content
 */

/**
 * Helper class for uploading images to azure blob storage based on their content checksum (md5).
 */
class BlobHandler {
  /**
   * Image handler construction.
   * @param {Object} opts - options.
   * @param {string} opts.azureBlobSAS - the Shared Access Secret to the azure blob store
   * @param {string} opts.azureBlobURI - the URI of the azure blob store.
   */
  constructor(opts = {}) {
    Object.assign(this, {
      _azureBlobSAS: opts.azureBlobSAS || process.env.AZURE_BLOB_SAS,
      _azureBlobURI: opts.azureBlobURI || process.env.AZURE_BLOB_URI,
      _log: opts.log || console,
      _cache: blobCache,
    });
  }

  /**
   * Creates an external resource from the given buffer and properties.
   * @param {Buffer} buffer - buffer with data
   * @param {string} [contentType] - content type
   * @param {string} [sourceUri] - source uri
   * @returns {ExternalResource} the external resource object.
   */
  createExternalResource(buffer, contentType, sourceUri) {
    // compute md5
    const sha1 = crypto.createHash('sha1')
      .update(buffer)
      .digest('hex');

    return {
      sourceUri: sourceUri || '',
      uri: `${this._azureBlobURI}/${sha1}`,
      body: buffer,
      contentType: contentType || 'application/octet-stream',
      contentLength: buffer.length,
      sha1,
    };
  }

  /**
   * Downloads the file addressed by `uri` and returns information representing the object.
   * @param {string} uri
   * @returns {ExternalResource} the external resource object or `null`,
   *                             if the resource could not be fetched.
   */
  async fetch(uri) {
    try { // todo: smarter download with eventual writing to disk.
      this._log.debug(`GET ${uri}`);
      const ret = await rp({
        uri,
        method: 'GET',
        encoding: null,
        resolveWithFullResponse: true,
      });
      this._log.debug({
        statusCode: ret.statusCode,
        headers: ret.headers,
      });
      return this.createExternalResource(ret.body, ret.headers['content-type'], uri);
    } catch (e) {
      this._log.error(`Error while downloading ${uri}: ${e.statusCode}`);
      return null;
    }
  }

  /**
   * Checks if the blob already exists using a HEAD request to the blob store.
   * @param {ExternalResource} blob - the resource object.
   * @returns {boolean} `true` if the resource exists.
   */
  async checkBlobExists(blob) {
    try {
      this._log.debug(`HEAD ${blob.uri}`);
      const ret = await rp({
        uri: blob.uri,
        method: 'HEAD',
        encoding: null,
        resolveWithFullResponse: true,
      });
      this._log.debug({
        statusCode: ret.statusCode,
        headers: ret.headers,
      });
      return true;
    } catch (e) {
      this._log.info(`Blob ${blob.uri} does not exist: ${e.statusCode}`);
      return false;
    }
  }

  /**
   * Uploads the blob to the blob store.
   * @param {ExternalResource} blob - the resource object.
   * @returns {boolean} `true` if the upload succeeded.
   */
  async upload(blob) {
    try {
      this._log.debug(`PUT ${blob.uri}`);
      const ret = await rp({
        uri: `${blob.uri}${this._azureBlobSAS}`,
        method: 'PUT',
        encoding: null,
        body: blob.body,
        resolveWithFullResponse: true,
        headers: {
          'content-type': blob.contentType || 'application/octet-stream',
          'x-ms-date': new Date().toString(),
          'x-ms-blob-type': 'BlockBlob',
        },
      });
      this._log.debug({
        statusCode: ret.statusCode,
        headers: ret.headers,
      });
      return true;
    } catch (e) {
      this._log.error(`Failed to upload blob ${blob.uri}: ${e.statusCode} ${e.message}`);
      return false;
    }
  }

  /**
   * Gets the blob information for the external resource addressed by uri. It also ensured that the
   * addressed blob is uploaded to the blob store.
   *
   * @param {string} uri - URI of the external resource.
   * @returns {ExternalResource} the external resource object or null if not exists.
   */
  async getBlob(uri) {
    if (uri in this._cache) {
      return this._cache[uri];
    }
    const blob = await this.fetch(uri);
    if (!blob) {
      return null;
    }
    const exists = await this.checkBlobExists(blob);
    if (!exists) {
      await this.upload(blob);
    }
    // don't cache the data
    delete blob.body;
    this._cache[uri] = blob;

    return blob;
  }

  async getBlobURI(buffer, contentType) {
    const blob = this.createExternalResource(buffer, contentType);
    const exists = await this.checkBlobExists(blob);
    if (!exists) {
      await this.upload(blob);
    }
    return blob;
  }

  async copyFromURL(url) {
    const computeSha = () => new Promise((resolve, reject) => {
      const hasher = crypto.createHash('sha1');
      hasher.setEncoding('hex');
      try {
        request.get({
          url,
          timeout: 5000,
        }, (error) => {
          if (error) {
            reject(error);
          }
        })
          .pipe(hasher)
          .on('finish', () => {
            const sha1 = hasher.read();
            this._log.debug(`sha1 computed for ${url}: ${sha1}`);
            resolve(sha1);
          })
          .on('error', (err) => {
            reject(err);
          });
      } catch (error) {
        reject(error);
      }
    });

    let sha1;
    try {
      sha1 = await computeSha();
    } catch (error) {
      this._log.warn(`sha cannot be computed for ${url}, probaby because resource does not exist`);
      return null;
    }

    const uri = `${this._azureBlobURI}/${sha1}`;
    if (!await this.checkBlobExists({ uri })) {
      try {
        // copying might take a while, only wait for the process start response
        await rp({
          uri: `${uri}${this._azureBlobSAS}`,
          method: 'PUT',
          encoding: null,
          // resolveWithFullResponse: true,
          timeout: 60000,
          headers: {
            'x-ms-date': new Date().toString(),
            'x-ms-blob-type': 'BlockBlob',
            'x-ms-copy-source': url,
          },
        });
      } catch (error) {
        const parseErrorMsg = (errorMessage) => {
          let msg = errorMessage;

          const m = msg.match(/{(.*)}/gm);
          if (m && m.length > 0) {
            try {
              msg = Buffer.from(JSON.parse(m[0]).data).toString();
            } catch (e) {
              // ignore
            }
          }
          return msg;
        };
        let msg = parseErrorMsg(error.message);

        if (msg && msg.indexOf('HTTP status code 301')) {
          // x-ms-copy-source API does not support images behind a 301
          // need to download the asset and upload it manually
          try {
            const ret = await rp({
              url,
              method: 'GET',
              encoding: null,
              resolveWithFullResponse: true,
            });
            if (ret.statusCode === 200) {
              this.upload(this.createExternalResource(ret.body, ret.headers['content-type'], uri));
            } else {
              this._log.warn(`${url} might not exist: ${ret.statusCode}`);
              return null;
            }
          } catch (e) {
            if (e.statusCode === 404) {
              this._log.warn(`${url} does not exist.`);
              return null;
            }
            msg = parseErrorMsg(e.message);
            this._log.error(`Cannot copy ${url} - resource might not exist: ${msg}`);
            //throw new Error(`Cannot copy ${url} - resource might not exist: ${msg}`);
            return null;
          }
        } else {
          this._log.error(`Error in x-ms-copy-source request: ${url}: ${msg}`);
          throw new Error(`Error in x-ms-copy-source request: ${url}: ${msg}`);
        }
      }
    } else {
      this._log.info(`Won't copy ${url}: already exists as ${uri}`);
    }
    return uri;
  }
}

module.exports = BlobHandler;
