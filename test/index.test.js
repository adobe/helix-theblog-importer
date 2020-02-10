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

/* eslint-env mocha */

'use strict';

const assert = require('assert');
const index = require('../src/index.js');

require('dotenv').config();

describe('Index Tests', () => {
  it('index function is present', async () => {
    const result = await index.main({});
    assert.deepEqual(result, { body: 'Missing url parameter' });
  });

  it('index function returns an object', async () => {
    const result = await index.main();
    assert.equal(typeof result, 'object');
  });
});

describe('Index Tests', () => {
  it.only('index with url', async () => {
    const result = await index.main({
      url: 'https://theblog.adobe.com/10-reasons-to-drop-what-youre-doing-and-register-for-adobe-summit-2020/',
      AZURE_BLOB_SAS: process.env.AZURE_BLOB_SAS,
      AZURE_BLOB_URI: process.env.AZURE_BLOB_URI,
      AZURE_ONEDRIVE_CLIENT_ID: process.env.AZURE_ONEDRIVE_CLIENT_ID,
      AZURE_ONEDRIVE_CLIENT_SECRET: process.env.AZURE_ONEDRIVE_CLIENT_SECRET,
      AZURE_ONEDRIVE_REFRESH_TOKEN: process.env.AZURE_ONEDRIVE_REFRESH_TOKEN,
      AZURE_ONEDRIVE_SHARED_LINK: process.env.AZURE_ONEDRIVE_SHARED_LINK,
    });
    assert.deepEqual(result, { body: 'Successfully imported https://theblog.adobe.com/10-reasons-to-drop-what-youre-doing-and-register-for-adobe-summit-2020/' });
  });
});
